export {
	checkGitInstalled,
	gitClone,
	gitInitAndPush,
	gitPull,
	gitPush,
	gitStatus,
	gitLog,
	gitDiff,
	gitAddCommit,
	gitGetUserInfo,
	gitSyncStatus,
	gitSync,
	gitHeadCommit,
	setGitToken,
	getGitToken,
	deleteGitToken,
	setGitCredential,
	deleteGitCredential,
	setGitSshAuth,
	deleteGitSshAuth,
} from './git-service';

export { gitStore } from './git-store';

export type {
	GitFileStatus,
	GitLogEntry,
	GitSyncStatus,
	GitUserInfo,
	GitConfig,
	GitSyncPhase,
} from './types';

export { KEYCHAIN_GIT_PREFIX } from './types';
