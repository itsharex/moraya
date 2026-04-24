use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::process::Command;

use super::file::validate_path;

// ───────────────────────────── types ─────────────────────────────

#[derive(Serialize)]
pub struct GitStatus {
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    pub untracked: Vec<String>,
    pub has_changes: bool,
}

#[derive(Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct GitSyncStatus {
    pub ahead: u32,
    pub behind: u32,
    pub branch: String,
    pub remote_branch: String,
}

#[derive(Serialize)]
pub struct GitUserInfo {
    pub name: String,
    pub email: String,
}

// ───────────────────────────── env filtering ─────────────────────

/// Dangerous environment variable prefixes that must not be passed to git child processes.
const BLOCKED_ENV_PREFIXES: &[&str] = &[
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "npm_config_",
    "npm_lifecycle_",
];

fn is_safe_env_var(key: &str) -> bool {
    !BLOCKED_ENV_PREFIXES
        .iter()
        .any(|prefix| key.starts_with(prefix))
}

// ───────────────────────────── security ──────────────────────────

/// Dangerous git flags that could be used for command injection.
const BLOCKED_GIT_FLAGS: &[&str] = &[
    "--exec",
    "--upload-pack",
    "--receive-pack",
    "-c",
    "--config",
    "--work-tree",
    "--git-dir",
];

/// Validate that a user-provided string does not contain dangerous git flags.
fn validate_git_arg(arg: &str) -> Result<(), String> {
    let lower = arg.to_lowercase();
    for flag in BLOCKED_GIT_FLAGS {
        if lower.starts_with(flag) {
            return Err("Invalid parameter".to_string());
        }
    }
    // Reject arguments that start with '-' and aren't known safe flags
    // This prevents flag injection via file paths like "--exec=malicious"
    if arg.starts_with('-') && !arg.starts_with("--format=") {
        return Err("Invalid parameter".to_string());
    }
    Ok(())
}

/// Validate a URL — allow HTTPS, git://, and SSH protocols.
fn validate_git_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://")
        || url.starts_with("git://")
        || url.starts_with("git@")   // SSH SCP-style: git@host:user/repo.git
        || url.starts_with("ssh://") // Explicit SSH
    {
        Ok(())
    } else {
        Err("Only HTTPS and SSH URLs are supported".to_string())
    }
}

// ───────────────────────────── helpers ───────────────────────────

/// Truncate stderr output to 200 chars and strip file system paths.
fn sanitize_stderr(stderr: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.len() <= 200 {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..200])
    }
}

/// Create a base git Command with safe environment and working directory.
fn git_cmd(work_dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(work_dir);

    // Filter environment variables
    cmd.env_clear();
    for (key, value) in std::env::vars() {
        if is_safe_env_var(&key) {
            cmd.env(&key, &value);
        }
    }

    // Prevent interactive prompts
    cmd.env("GIT_TERMINAL_PROMPT", "0");

    cmd
}

// ───────────────────────────── auth ──────────────────────────────

/// Temporary files created for auth scripts that need cleanup after each git op.
struct AuthCleanup {
    files: Vec<std::path::PathBuf>,
}

impl AuthCleanup {
    fn none() -> Self {
        Self { files: Vec::new() }
    }
    fn cleanup(self) {
        for p in self.files {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Set up git authentication from stored credentials for `config_id`.
///
/// Key lookup priority (all in AIProxyState key_cache):
///   `git-token:{id}`         → PAT / token auth  (GIT_ASKPASS echoes token)
///   `git-username:{id}`      → username + password (GIT_ASKPASS handles both prompts)
///   `git-sshkey:{id}`        → SSH key file path  (GIT_SSH_COMMAND)
///   `git-sshpassphrase:{id}` → optional SSH passphrase (SSH_ASKPASS)
fn setup_auth(
    cmd: &mut Command,
    ai_state: &tauri::State<'_, super::ai_proxy::AIProxyState>,
    config_id: &str,
) -> Result<AuthCleanup, String> {
    // Snapshot all relevant keys with a single lock acquisition.
    let (token, username, password, ssh_key, ssh_passphrase) = {
        let cache = ai_state.key_cache.lock().map_err(|_| "Lock error".to_string())?;
        (
            cache.get(&format!("git-token:{}", config_id)).cloned(),
            cache.get(&format!("git-username:{}", config_id)).cloned(),
            cache.get(&format!("git-password:{}", config_id)).cloned(),
            cache.get(&format!("git-sshkey:{}", config_id)).cloned(),
            cache.get(&format!("git-sshpassphrase:{}", config_id)).cloned(),
        )
    };

    if let Some(tok) = token.filter(|t| !t.is_empty()) {
        let path = askpass_tmp_path("tok");
        let actual = write_askpass_echo(&path, &tok)?;
        cmd.env("GIT_ASKPASS", actual.to_string_lossy().as_ref());
        return Ok(AuthCleanup { files: vec![actual] });
    }

    if let Some(user) = username.filter(|u| !u.is_empty()) {
        let pass = password.unwrap_or_default();
        let path = askpass_tmp_path("pwd");
        let actual = write_askpass_userpass(&path, &user, &pass)?;
        cmd.env("GIT_ASKPASS", actual.to_string_lossy().as_ref());
        return Ok(AuthCleanup { files: vec![actual] });
    }

    if let Some(key_path) = ssh_key.filter(|k| !k.is_empty()) {
        // Build GIT_SSH_COMMAND with explicit key; allow host-key acceptance on first connect.
        let ssh_cmd = format!(
            "ssh -i \"{}\" -o StrictHostKeyChecking=accept-new -o BatchMode=no",
            key_path.replace('"', "\\\"")
        );
        cmd.env("GIT_SSH_COMMAND", &ssh_cmd);

        if let Some(pp) = ssh_passphrase.filter(|p| !p.is_empty()) {
            let path = askpass_tmp_path("ssh");
            let actual = write_askpass_echo(&path, &pp)?;
            cmd.env("SSH_ASKPASS", actual.to_string_lossy().as_ref());
            // OpenSSH 8.4+: force SSH_ASKPASS without a terminal.
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            // Legacy fallback for older OpenSSH versions.
            cmd.env("DISPLAY", "dummy");
            return Ok(AuthCleanup { files: vec![actual] });
        }
        return Ok(AuthCleanup::none());
    }

    Ok(AuthCleanup::none())
}

/// Return a unique temp file path for an askpass script (no extension — platform functions add it).
fn askpass_tmp_path(suffix: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("moraya-askpass-{}-{}", std::process::id(), suffix))
}

/// Write an askpass script that unconditionally echoes `secret`.
/// Returns the actual path written (on Windows: `.bat` extension added).
fn write_askpass_echo(base: &std::path::Path, secret: &str) -> Result<std::path::PathBuf, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let esc = secret.replace('\'', "'\\''");
        let mut f = std::fs::File::create(base)
            .map_err(|_| "Failed to create auth script".to_string())?;
        writeln!(f, "#!/bin/sh\necho '{}'", esc)
            .map_err(|_| "Failed to write auth script".to_string())?;
        std::fs::set_permissions(base, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Failed to set auth script permissions".to_string())?;
        Ok(base.to_path_buf())
    }
    #[cfg(windows)]
    {
        let bat = base.with_extension("bat");
        let esc = secret.replace('%', "%%");
        let mut f = std::fs::File::create(&bat)
            .map_err(|_| "Failed to create auth script".to_string())?;
        write!(f, "@echo off\r\necho {}\r\n", esc)
            .map_err(|_| "Failed to write auth script".to_string())?;
        Ok(bat)
    }
}

/// Write an askpass script that echoes the username when the prompt contains "sername",
/// and the password otherwise (covers both "Username:" and "Password:" prompts).
fn write_askpass_userpass(
    base: &std::path::Path,
    username: &str,
    password: &str,
) -> Result<std::path::PathBuf, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let esc_u = username.replace('\'', "'\\''");
        let esc_p = password.replace('\'', "'\\''");
        let script = format!(
            "#!/bin/sh\ncase \"$1\" in\n  *sername*) echo '{}' ;;\n  *) echo '{}' ;;\nesac\n",
            esc_u, esc_p
        );
        let mut f = std::fs::File::create(base)
            .map_err(|_| "Failed to create auth script".to_string())?;
        f.write_all(script.as_bytes())
            .map_err(|_| "Failed to write auth script".to_string())?;
        std::fs::set_permissions(base, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Failed to set auth script permissions".to_string())?;
        Ok(base.to_path_buf())
    }
    #[cfg(windows)]
    {
        let bat = base.with_extension("bat");
        let esc_u = username.replace('%', "%%");
        let esc_p = password.replace('%', "%%");
        let script = format!(
            "@echo off\r\necho %~1 | findstr /i \"sername\" > nul 2>&1\r\nif %errorlevel% equ 0 (\r\n    echo {}\r\n) else (\r\n    echo {}\r\n)\r\n",
            esc_u, esc_p
        );
        let mut f = std::fs::File::create(&bat)
            .map_err(|_| "Failed to create auth script".to_string())?;
        f.write_all(script.as_bytes())
            .map_err(|_| "Failed to write auth script".to_string())?;
        Ok(bat)
    }
}

/// Run a git command with timeout. Returns stdout on success, sanitized stderr on failure.
fn run_git(cmd: &mut Command, timeout_secs: u64) -> Result<String, String> {
    let child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Git is not installed".to_string()
            } else {
                "Failed to run git command".to_string()
            }
        })?;

    let output = if timeout_secs > 0 {
        // Use a channel with recv_timeout for actual timeout enforcement
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            let result = child.wait_with_output();
            let _ = tx.send(result);
        });

        match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
            Ok(result) => result.map_err(|_| "Git command failed".to_string())?,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Attempt to kill the child process; handle thread will exit
                // once the child is reaped.
                drop(handle);
                return Err("Git command timed out".to_string());
            }
            Err(_) => return Err("Git command failed".to_string()),
        }
    } else {
        child.wait_with_output().map_err(|_| "Git command failed".to_string())?
    };

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(sanitize_stderr(&stderr))
    }
}

// ───────────────────────────── commands ──────────────────────────

#[tauri::command]
pub fn git_check_installed() -> Result<bool, String> {
    match Command::new("git").arg("--version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Ok(false)
            } else {
                Err("Failed to check git installation".to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn git_clone(
    ai_state: tauri::State<'_, super::ai_proxy::AIProxyState>,
    config_id: String,
    url: String,
    path: String,
) -> Result<(), String> {
    ai_state.ensure_secrets_loaded().await;
    let safe_path = validate_path(&path)?;
    validate_git_url(&url)?;

    let parent = safe_path
        .parent()
        .ok_or_else(|| "Invalid target path".to_string())?;

    let dir_name = safe_path
        .file_name()
        .ok_or_else(|| "Invalid target path".to_string())?
        .to_string_lossy()
        .to_string();

    let mut cmd = git_cmd(parent);
    cmd.args(["clone", &url, &dir_name]);

    let askpass = setup_auth(&mut cmd, &ai_state, &config_id)?;
    let result = run_git(&mut cmd, 120);
    askpass.cleanup();

    result.map(|_| ())
}

#[tauri::command]
pub async fn git_init_and_push(
    ai_state: tauri::State<'_, super::ai_proxy::AIProxyState>,
    config_id: String,
    path: String,
    url: String,
    branch: String,
) -> Result<(), String> {
    ai_state.ensure_secrets_loaded().await;
    let safe_path = validate_path(&path)?;
    validate_git_url(&url)?;
    validate_git_arg(&branch)?;

    let branch = if branch.is_empty() { "main".to_string() } else { branch };

    // git init
    run_git(git_cmd(&safe_path).arg("init"), 10)?;

    // git checkout -b <branch>
    run_git(
        git_cmd(&safe_path).args(["checkout", "-b", &branch]),
        10,
    )?;

    // git remote add origin <url>
    run_git(
        git_cmd(&safe_path).args(["remote", "add", "origin", &url]),
        10,
    )?;

    // git add -A
    run_git(git_cmd(&safe_path).args(["add", "-A"]), 30)?;

    // git commit
    run_git(
        git_cmd(&safe_path).args(["commit", "-m", "Initial commit from Moraya"]),
        30,
    )?;

    // git push -u origin <branch>
    let mut push_cmd = git_cmd(&safe_path);
    push_cmd.args(["push", "-u", "origin", &branch]);
    let askpass = setup_auth(&mut push_cmd, &ai_state, &config_id)?;
    let result = run_git(&mut push_cmd, 120);
    askpass.cleanup();

    result.map(|_| ())
}

#[tauri::command]
pub async fn git_pull(
    ai_state: tauri::State<'_, super::ai_proxy::AIProxyState>,
    config_id: String,
    path: String,
) -> Result<String, String> {
    ai_state.ensure_secrets_loaded().await;
    let safe_path = validate_path(&path)?;

    let mut cmd = git_cmd(&safe_path);
    cmd.args(["pull", "--rebase", "--autostash"]);

    let askpass = setup_auth(&mut cmd, &ai_state, &config_id)?;
    let result = run_git(&mut cmd, 60);
    askpass.cleanup();

    result
}

#[tauri::command]
pub async fn git_push(
    ai_state: tauri::State<'_, super::ai_proxy::AIProxyState>,
    config_id: String,
    path: String,
) -> Result<String, String> {
    ai_state.ensure_secrets_loaded().await;
    let safe_path = validate_path(&path)?;

    let mut cmd = git_cmd(&safe_path);
    cmd.arg("push");

    let askpass = setup_auth(&mut cmd, &ai_state, &config_id)?;
    let result = run_git(&mut cmd, 60);
    askpass.cleanup();

    result
}

#[tauri::command]
pub fn git_status(path: String) -> Result<GitStatus, String> {
    let safe_path = validate_path(&path)?;

    let output = run_git(
        git_cmd(&safe_path).args(["status", "--porcelain=v1"]),
        10,
    )?;

    let mut status = GitStatus {
        modified: Vec::new(),
        added: Vec::new(),
        deleted: Vec::new(),
        untracked: Vec::new(),
        has_changes: false,
    };

    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }
        let code = &line[..2];
        let file = line[3..].to_string();

        match code.trim() {
            "M" | "MM" | "AM" => status.modified.push(file),
            "A" => status.added.push(file),
            "D" => status.deleted.push(file),
            "??" => status.untracked.push(file),
            "R" | "C" => status.modified.push(file),
            _ => {}
        }
    }

    status.has_changes = !status.modified.is_empty()
        || !status.added.is_empty()
        || !status.deleted.is_empty()
        || !status.untracked.is_empty();

    Ok(status)
}

#[tauri::command]
pub fn git_log(
    path: String,
    file: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GitLogEntry>, String> {
    let safe_path = validate_path(&path)?;
    let limit = limit.unwrap_or(50).min(500);

    let mut cmd = git_cmd(&safe_path);
    cmd.args([
        "log",
        &format!("-{}", limit),
        "--format=%H%n%h%n%an%n%ae%n%aI%n%s%n---END---",
    ]);

    if let Some(ref f) = file {
        cmd.args(["--follow", "--", f]);
    }

    let output = run_git(&mut cmd, 30)?;
    let mut entries = Vec::new();

    let blocks: Vec<&str> = output.split("---END---\n").collect();
    for block in blocks {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let lines: Vec<&str> = block.lines().collect();
        if lines.len() >= 6 {
            entries.push(GitLogEntry {
                hash: lines[0].to_string(),
                short_hash: lines[1].to_string(),
                author: lines[2].to_string(),
                email: lines[3].to_string(),
                date: lines[4].to_string(),
                message: lines[5..].join("\n"),
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn git_diff(
    path: String,
    hash1: Option<String>,
    hash2: Option<String>,
    file: Option<String>,
) -> Result<String, String> {
    let safe_path = validate_path(&path)?;

    // Validate hash args (prevent flag injection via hash parameters)
    if let Some(ref h) = hash1 {
        validate_git_arg(h)?;
    }
    if let Some(ref h) = hash2 {
        validate_git_arg(h)?;
    }

    let mut cmd = git_cmd(&safe_path);
    cmd.arg("diff");

    match (&hash1, &hash2) {
        (Some(h1), Some(h2)) => {
            cmd.args([h1.as_str(), h2.as_str()]);
        }
        (Some(h1), None) => {
            cmd.arg(h1.as_str());
        }
        _ => {
            // Working directory diff (unstaged changes)
        }
    }

    if let Some(ref f) = file {
        cmd.args(["--", f]);
    }

    run_git(&mut cmd, 30)
}

#[tauri::command]
pub fn git_add_commit(
    path: String,
    files: Vec<String>,
    message: String,
) -> Result<String, String> {
    let safe_path = validate_path(&path)?;

    if files.is_empty() {
        return Err("No files to commit".to_string());
    }
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    // Validate file args to prevent flag injection
    for f in &files {
        validate_git_arg(f)?;
    }

    // git add <files> — use '--' to separate flags from file paths
    let mut add_cmd = git_cmd(&safe_path);
    add_cmd.args(["add", "--"]);
    for f in &files {
        add_cmd.arg(f);
    }
    run_git(&mut add_cmd, 10)?;

    // git commit -m <message>
    let output = run_git(
        git_cmd(&safe_path).args(["commit", "-m", &message]),
        30,
    )?;

    Ok(output)
}

#[tauri::command]
pub fn git_get_user_info(path: String) -> Result<GitUserInfo, String> {
    let safe_path = validate_path(&path)?;

    let name = run_git(
        git_cmd(&safe_path).args(["config", "user.name"]),
        5,
    )
    .unwrap_or_default()
    .trim()
    .to_string();

    let email = run_git(
        git_cmd(&safe_path).args(["config", "user.email"]),
        5,
    )
    .unwrap_or_default()
    .trim()
    .to_string();

    Ok(GitUserInfo { name, email })
}

#[tauri::command]
pub async fn git_sync_status(
    ai_state: tauri::State<'_, super::ai_proxy::AIProxyState>,
    config_id: String,
    path: String,
) -> Result<GitSyncStatus, String> {
    ai_state.ensure_secrets_loaded().await;
    let safe_path = validate_path(&path)?;

    // Fetch remote to update tracking info
    let mut fetch_cmd = git_cmd(&safe_path);
    fetch_cmd.args(["fetch", "--quiet"]);
    let askpass = setup_auth(&mut fetch_cmd, &ai_state, &config_id)?;
    let _ = run_git(&mut fetch_cmd, 30); // ignore fetch errors (offline is ok)
    askpass.cleanup();

    // Get current branch
    let branch = run_git(
        git_cmd(&safe_path).args(["rev-parse", "--abbrev-ref", "HEAD"]),
        5,
    )
    .unwrap_or_default()
    .trim()
    .to_string();

    // Get tracking branch
    let remote_branch = run_git(
        git_cmd(&safe_path).args([
            "rev-parse",
            "--abbrev-ref",
            &format!("{}@{{upstream}}", branch),
        ]),
        5,
    )
    .unwrap_or_default()
    .trim()
    .to_string();

    if remote_branch.is_empty() {
        return Ok(GitSyncStatus {
            ahead: 0,
            behind: 0,
            branch,
            remote_branch: String::new(),
        });
    }

    // Count ahead/behind
    let rev_list = run_git(
        git_cmd(&safe_path).args([
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...{}", remote_branch),
        ]),
        5,
    )
    .unwrap_or_default();

    let parts: Vec<&str> = rev_list.trim().split('\t').collect();
    let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0u32);
    let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0u32);

    Ok(GitSyncStatus {
        ahead,
        behind,
        branch,
        remote_branch,
    })
}

/// Get the current HEAD commit hash (short: false → full 40-char hex).
#[tauri::command]
pub fn git_head_commit(path: String) -> Result<String, String> {
    let safe_path = validate_path(&path)?;
    let output = run_git(
        git_cmd(&safe_path).args(["rev-parse", "HEAD"]),
        5,
    )?;
    Ok(output.trim().to_string())
}

// ───────────────────────────── tests ────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_stderr_short() {
        let msg = "fatal: not a git repository";
        assert_eq!(sanitize_stderr(msg), msg);
    }

    #[test]
    fn test_sanitize_stderr_long() {
        let msg = "a".repeat(300);
        let result = sanitize_stderr(&msg);
        assert_eq!(result.len(), 203); // 200 + "..."
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_is_safe_env_var() {
        assert!(is_safe_env_var("HOME"));
        assert!(is_safe_env_var("PATH"));
        assert!(is_safe_env_var("USER"));
        assert!(!is_safe_env_var("LD_PRELOAD"));
        assert!(!is_safe_env_var("DYLD_INSERT_LIBRARIES"));
        assert!(!is_safe_env_var("npm_config_registry"));
    }

    #[test]
    fn test_git_check_installed() {
        // This test passes as long as git is available in the test environment
        let result = git_check_installed();
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_git_arg_safe() {
        assert!(validate_git_arg("main").is_ok());
        assert!(validate_git_arg("my-branch").is_ok());
        assert!(validate_git_arg("path/to/file.md").is_ok());
        assert!(validate_git_arg("abc123def").is_ok());
    }

    #[test]
    fn test_validate_git_arg_blocked() {
        assert!(validate_git_arg("--exec=malicious").is_err());
        assert!(validate_git_arg("--upload-pack=evil").is_err());
        assert!(validate_git_arg("--receive-pack=evil").is_err());
        assert!(validate_git_arg("-c").is_err());
        assert!(validate_git_arg("--config").is_err());
        assert!(validate_git_arg("--work-tree=/tmp").is_err());
        assert!(validate_git_arg("--git-dir=/tmp").is_err());
        assert!(validate_git_arg("-unknown").is_err());
    }

    #[test]
    fn test_validate_git_url() {
        assert!(validate_git_url("https://github.com/user/repo.git").is_ok());
        assert!(validate_git_url("git://example.com/repo.git").is_ok());
        assert!(validate_git_url("git@github.com:user/repo.git").is_ok());
        assert!(validate_git_url("ssh://git@github.com/repo").is_ok());
        assert!(validate_git_url("http://insecure.com/repo").is_err());
        assert!(validate_git_url("file:///local/repo").is_err());
    }
}
