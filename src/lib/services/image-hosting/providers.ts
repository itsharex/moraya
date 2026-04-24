import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import type { ImageHostConfig, UploadResult } from './types';

/** Map a MIME to a bare file extension (no dot). */
function extFromMime(mime: string): string | null {
  const m = (mime || '').toLowerCase();
  switch (m) {
    case 'image/png':      return 'png';
    case 'image/jpeg':     return 'jpg';
    case 'image/gif':      return 'gif';
    case 'image/webp':     return 'webp';
    case 'image/svg+xml':  return 'svg';
    case 'image/bmp':      return 'bmp';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon': return 'ico';
    case 'image/avif':     return 'avif';
    case 'image/tiff':     return 'tiff';
    case 'image/heic':     return 'heic';
    default: return null;
  }
}

/**
 * Generate a timestamped filename to avoid conflicts.
 * e.g. "20260205-143052-photo.png"
 */
function timestampedName(originalName: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1-$2');
  const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : '.png';
  const base = originalName.includes('.')
    ? originalName.slice(0, originalName.lastIndexOf('.')).replace(/[^a-zA-Z0-9_-]/g, '')
    : 'image';
  return `${ts}-${base || 'image'}${ext}`;
}

/**
 * Parse owner and repo from a GitHub/Gitea/git-custom URL.
 */
function parseGitRepoUrl(repoUrl: string): { host: string; owner: string; repo: string } {
  const cleaned = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
  const match = cleaned.match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) throw new Error(`Invalid repository URL: ${repoUrl}`);
  return { host: match[1], owner: match[2], repo: match[3] };
}

async function uploadToGitHub(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  if (!config.githubRepoUrl || !config.githubToken) {
    throw new Error('GitHub image hosting is not configured');
  }

  const { owner, repo } = parseGitRepoUrl(config.githubRepoUrl);
  const branch = config.githubBranch || 'main';
  const dir = (config.githubDir || 'images/').replace(/\/$/, '');

  // Generate timestamped filename
  const fileName = timestampedName((blob as File).name || 'image.png');
  const filePath = `${dir}/${fileName}`;

  // Read blob as base64
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Content = btoa(binary);

  // Upload via GitHub Contents API
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const res = await tauriFetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `upload: ${fileName}`,
      content: base64Content,
      branch,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub upload failed (${res.status}): ${errBody}`);
  }

  // Build access URL based on CDN mode
  let imageUrl: string;
  if (config.githubCdn === 'jsdelivr') {
    imageUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`;
  } else {
    imageUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  return { url: imageUrl };
}

async function uploadToGitLab(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  if (!config.gitlabRepoUrl || !config.gitlabToken) {
    throw new Error('GitLab image hosting is not configured');
  }

  const { host, owner, repo } = parseGitRepoUrl(config.gitlabRepoUrl);
  const branch = config.gitlabBranch || 'main';
  const dir = (config.gitlabDir || 'images/').replace(/\/$/, '');

  const fileName = timestampedName((blob as File).name || 'image.png');
  const filePath = `${dir}/${fileName}`;

  // Read blob as base64
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Content = btoa(binary);

  // URL-encode the project path and file path for GitLab API
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const encodedFilePath = encodeURIComponent(filePath);
  const url = `${host}/api/v4/projects/${projectPath}/repository/files/${encodedFilePath}`;

  const res = await tauriFetch(url, {
    method: 'PUT',
    headers: {
      'PRIVATE-TOKEN': config.gitlabToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      branch,
      content: base64Content,
      encoding: 'base64',
      commit_message: `upload: ${fileName}`,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitLab upload failed (${res.status}): ${errBody}`);
  }

  // GitLab raw file URL
  const imageUrl = `${host}/${owner}/${repo}/-/raw/${branch}/${filePath}`;
  return { url: imageUrl };
}

async function uploadToGitCustom(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  if (!config.gitCustomRepoUrl || !config.gitCustomToken) {
    throw new Error('Custom Git image hosting is not configured');
  }

  const { host, owner, repo } = parseGitRepoUrl(config.gitCustomRepoUrl);
  const branch = config.gitCustomBranch || 'main';
  const dir = (config.gitCustomDir || 'images/').replace(/\/$/, '');

  const fileName = timestampedName((blob as File).name || 'image.png');
  const filePath = `${dir}/${fileName}`;

  // Read blob as base64
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Content = btoa(binary);

  // Gitea/Forgejo: GitHub Contents API compatible
  const url = `${host}/api/v1/repos/${owner}/${repo}/contents/${filePath}`;
  const res = await tauriFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.gitCustomToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `upload: ${fileName}`,
      content: base64Content,
      branch,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Git upload failed (${res.status}): ${errBody}`);
  }

  // Gitea/Forgejo raw URL
  const imageUrl = `${host}/${owner}/${repo}/raw/branch/${branch}/${filePath}`;
  return { url: imageUrl };
}

async function uploadToPicora(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  if (!config.picoraApiUrl || !config.picoraApiKey) {
    throw new Error('Picora is not configured (missing endpoint or API key)');
  }
  const arrayBuffer = await blob.arrayBuffer();
  const fileBytes = Array.from(new Uint8Array(arrayBuffer));
  const ext = extFromMime(blob.type) || 'png';
  const filename = timestampedName((blob as File).name || `image.${ext}`);
  const url = await invoke<string>('upload_to_picora', {
    apiUrl: config.picoraApiUrl,
    apiKey: config.picoraApiKey,
    fileBytes,
    mimeType: blob.type || 'image/png',
    filename,
  });
  return { url };
}

async function uploadToSmms(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('smfile', blob, 'image.png');

  const res = await tauriFetch('https://sm.ms/api/v2/upload', {
    method: 'POST',
    headers: {
      Authorization: config.apiToken,
    },
    body: formData,
  });

  const json = await res.json();
  if (!json.success && json.code !== 'image_repeated') {
    throw new Error(json.message || 'SM.MS upload failed');
  }

  const data = json.code === 'image_repeated' ? json.images : json.data;
  return {
    url: data.url,
    deleteUrl: data.delete,
  };
}

async function uploadToImgur(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('image', blob);

  const res = await tauriFetch('https://api.imgur.com/3/image', {
    method: 'POST',
    headers: {
      Authorization: `Client-ID ${config.apiToken}`,
    },
    body: formData,
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.data?.error || 'Imgur upload failed');
  }

  return {
    url: json.data.link,
    deleteUrl: json.data.deletehash
      ? `https://api.imgur.com/3/image/${json.data.deletehash}`
      : undefined,
  };
}

async function uploadToCustom(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  if (!config.customEndpoint) {
    throw new Error('Custom endpoint is not configured');
  }

  const formData = new FormData();
  // Derive a sensible filename extension from the blob's MIME so the server
  // doesn't receive `image.png` for a `.webp`/`.jpeg`/etc. payload.
  const ext = extFromMime(blob.type) || 'png';
  formData.append('file', blob, `image.${ext}`);

  let headers: Record<string, string> = {};
  if (config.apiToken) {
    headers['Authorization'] = `Bearer ${config.apiToken}`;
  }
  if (config.customHeaders) {
    try {
      const parsed = JSON.parse(config.customHeaders);
      headers = { ...headers, ...parsed };
    } catch {
      // Invalid JSON headers, ignore
    }
  }

  const res = await tauriFetch(config.customEndpoint, {
    method: 'POST',
    headers,
    body: formData,
  });

  const rawText = await res.text();

  if (!res.ok) {
    const snippet = rawText.slice(0, 300);
    throw new Error(`Upload failed: ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Unexpected non-JSON response: ${rawText.slice(0, 300)}`);
  }

  const detectedUrl = pickUrlFromResponse(json);
  const template = (config.customUrlTemplate || '').trim();

  let url: string | undefined;
  if (template) {
    url = renderUrlTemplate(template, json, detectedUrl);
  } else {
    url = detectedUrl;
  }

  if (!url) {
    throw new Error(`Could not find image URL in response: ${JSON.stringify(json).slice(0, 1000)}`);
  }

  return { url };
}

/** Render URL template by replacing {field} placeholders with response values.
 *  Supports dot paths like {data.id}, {data.storageKey}. Bare {id} / {storageKey} /
 *  {filename} / {url} also resolve against the response root and common {data: {...}} wrapper. */
function renderUrlTemplate(template: string, json: Record<string, unknown>, detectedUrl?: string): string {
  const pick = (path: string): string | undefined => {
    if (path === 'url' && detectedUrl) return detectedUrl;
    const parts = path.split('.');
    // Try exact path first
    let val: unknown = json;
    for (const p of parts) {
      if (val && typeof val === 'object' && p in (val as object)) {
        val = (val as Record<string, unknown>)[p];
      } else {
        val = undefined;
        break;
      }
    }
    if (typeof val === 'string' || typeof val === 'number') return String(val);
    // Fallback: look inside {data: {...}} wrapper for bare keys
    if (parts.length === 1 && json.data && typeof json.data === 'object') {
      const d = (json.data as Record<string, unknown>)[parts[0]];
      if (typeof d === 'string' || typeof d === 'number') return String(d);
    }
    return undefined;
  };
  return template.replace(/\{([^{}]+)\}/g, (_, key) => pick(key.trim()) ?? '');
}

/** Walk common response shapes for an image URL field. */
function pickUrlFromResponse(json: Record<string, unknown>): string | undefined {
  const candidates = [
    (json as any).url,
    (json as any).data?.url,
    (json as any).data?.link,
    (json as any).data?.fullurl,
    (json as any).data?.image_url,
    (json as any).data?.src,
    (json as any).src,
    (json as any).link,
    (json as any).fullurl,
    (json as any).image?.url,
    (json as any).image_url,
    (json as any).result?.url,
    (json as any).result?.link,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return undefined;
}

/**
 * Upload to object storage providers (Qiniu, Aliyun OSS, Tencent COS, AWS S3, Google GCS).
 * HMAC signing is handled by the Rust backend to keep secrets out of frontend.
 */
async function uploadToObjectStorage(blob: Blob, config: ImageHostConfig): Promise<UploadResult> {
  if (!config.ossBucket || !config.ossRegion) {
    throw new Error('Object storage is not configured (missing bucket or region)');
  }

  // Qiniu upload API returns only the object key, not a full URL.
  // A CDN domain is required to construct a valid download URL.
  // Without it, the upload "succeeds" but sets src to just a filename, breaking the image.
  if (config.provider === 'qiniu' && !config.ossCdnDomain) {
    throw new Error('七牛云上传失败：请先在图床设置中配置 CDN 加速域名（CDN Domain），否则无法生成可访问的图片链接。');
  }

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(arrayBuffer));
  const fileName = timestampedName((blob as File).name || 'image.png');
  const prefix = (config.ossPathPrefix || '').replace(/\/$/, '');
  const objectKey = prefix ? `${prefix}/${fileName}` : fileName;

  const resultUrl = await invoke<string>('upload_to_object_storage', {
    provider: config.provider,
    accessKey: config.ossAccessKey,
    secretKey: config.ossSecretKey,
    bucket: config.ossBucket,
    region: config.ossRegion,
    endpoint: config.ossEndpoint || null,
    objectKey,
    data: bytes,
    contentType: blob.type || 'image/png',
  });

  // Apply CDN domain if configured
  if (config.ossCdnDomain) {
    const cdnBase = config.ossCdnDomain.replace(/\/$/, '');
    return { url: `${cdnBase}/${objectKey}` };
  }

  return { url: resultUrl };
}

export const providers: Record<
  string,
  (blob: Blob, config: ImageHostConfig) => Promise<UploadResult>
> = {
  picora: uploadToPicora,
  smms: uploadToSmms,
  imgur: uploadToImgur,
  github: uploadToGitHub,
  gitlab: uploadToGitLab,
  'git-custom': uploadToGitCustom,
  custom: uploadToCustom,
  qiniu: uploadToObjectStorage,
  'aliyun-oss': uploadToObjectStorage,
  'tencent-cos': uploadToObjectStorage,
  'aws-s3': uploadToObjectStorage,
  'google-gcs': uploadToObjectStorage,
};
