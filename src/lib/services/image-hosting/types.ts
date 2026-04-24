export type ImageHostProvider =
  | 'picora'
  | 'smms' | 'imgur' | 'github' | 'gitlab' | 'git-custom' | 'custom'
  | 'qiniu' | 'aliyun-oss' | 'tencent-cos' | 'aws-s3' | 'google-gcs';

/** Default Picora SaaS endpoints. Editable per target. */
export const PICORA_DEFAULT_API_URL = 'https://api.picora.me/v1/images';
export const PICORA_DEFAULT_IMG_DOMAIN = 'https://media.picora.me';
export const PICORA_DEFAULT_API_BASE = 'https://api.picora.me';

export type GitHubCdnMode = 'raw' | 'jsdelivr';

export interface ImageHostConfig {
  provider: ImageHostProvider;
  apiToken: string;
  customEndpoint: string;
  customHeaders: string; // JSON string
  customUrlTemplate: string; // URL template with {id}/{storageKey}/{filename}/{url} placeholders
  autoUpload: boolean;
  // GitHub image hosting fields
  githubRepoUrl: string;     // https://github.com/user/images
  githubBranch: string;      // main
  githubDir: string;         // images/
  githubToken: string;       // GitHub PAT
  githubCdn: GitHubCdnMode; // 'raw' | 'jsdelivr'
  // GitLab image hosting fields
  gitlabRepoUrl: string;     // https://gitlab.com/user/images
  gitlabBranch: string;      // main
  gitlabDir: string;         // images/
  gitlabToken: string;       // GitLab PAT
  // Custom Git (Gitea/Forgejo) fields
  gitCustomRepoUrl: string;  // https://git.example.com/user/images
  gitCustomBranch: string;   // main
  gitCustomDir: string;      // images/
  gitCustomToken: string;    // PAT
  // Object storage fields (OSS/S3/COS/GCS/Qiniu)
  ossAccessKey: string;      // AccessKey ID
  ossSecretKey: string;      // SecretKey
  ossBucket: string;         // Bucket name
  ossRegion: string;         // Region
  ossEndpoint: string;       // Custom endpoint (S3-compatible or private)
  ossCdnDomain: string;      // CDN domain (replaces default URL prefix)
  ossPathPrefix: string;     // Path prefix inside bucket (e.g. "images/blog/")
  // Picora SaaS image host
  picoraApiUrl: string;      // Upload endpoint (default https://api.picora.me/v1/images)
  picoraApiKey: string;      // Bearer token (sk_live_...)
  picoraImgDomain: string;   // Public CDN base (default https://media.picora.me)
  picoraUserEmail: string;   // Display-only, populated by import flow
}

export interface UploadResult {
  url: string;
  deleteUrl?: string;
}

export const DEFAULT_IMAGE_HOST_CONFIG: ImageHostConfig = {
  provider: 'custom',
  apiToken: '',
  customEndpoint: '',
  customHeaders: '',
  customUrlTemplate: '',
  autoUpload: false,
  githubRepoUrl: '',
  githubBranch: 'main',
  githubDir: 'images/',
  githubToken: '',
  githubCdn: 'raw',
  gitlabRepoUrl: '',
  gitlabBranch: 'main',
  gitlabDir: 'images/',
  gitlabToken: '',
  gitCustomRepoUrl: '',
  gitCustomBranch: 'main',
  gitCustomDir: 'images/',
  gitCustomToken: '',
  ossAccessKey: '',
  ossSecretKey: '',
  ossBucket: '',
  ossRegion: '',
  ossEndpoint: '',
  ossCdnDomain: '',
  ossPathPrefix: '',
  picoraApiUrl: PICORA_DEFAULT_API_URL,
  picoraApiKey: '',
  picoraImgDomain: PICORA_DEFAULT_IMG_DOMAIN,
  picoraUserEmail: '',
};

export interface ImageHostTarget {
  id: string;
  name: string;
  provider: ImageHostProvider;
  apiToken: string;
  customEndpoint: string;
  customHeaders: string;
  customUrlTemplate: string;
  autoUpload: boolean;
  githubRepoUrl: string;
  githubBranch: string;
  githubDir: string;
  githubToken: string;
  githubCdn: GitHubCdnMode;
  gitlabRepoUrl: string;
  gitlabBranch: string;
  gitlabDir: string;
  gitlabToken: string;
  gitCustomRepoUrl: string;
  gitCustomBranch: string;
  gitCustomDir: string;
  gitCustomToken: string;
  ossAccessKey: string;
  ossSecretKey: string;
  ossBucket: string;
  ossRegion: string;
  ossEndpoint: string;
  ossCdnDomain: string;
  ossPathPrefix: string;
  picoraApiUrl: string;
  picoraApiKey: string;
  picoraImgDomain: string;
  picoraUserEmail: string;
  /** Set by Picora import flow; affects sort order and badge rendering. */
  featured?: boolean;
  /** Unix ms when this target was imported from Picora; display-only. */
  picoraImportedAt?: number;
}

export function generateImageHostTargetId(): string {
  return `imghost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultImageHostTarget(provider: ImageHostProvider): ImageHostTarget {
  return {
    id: generateImageHostTargetId(),
    name: provider === 'picora' ? 'Picora' : '',
    provider,
    apiToken: '',
    customEndpoint: '',
    customHeaders: '',
    customUrlTemplate: '',
    autoUpload: provider === 'picora',
    githubRepoUrl: '',
    githubBranch: 'main',
    githubDir: 'images/',
    githubToken: '',
    githubCdn: 'raw',
    gitlabRepoUrl: '',
    gitlabBranch: 'main',
    gitlabDir: 'images/',
    gitlabToken: '',
    gitCustomRepoUrl: '',
    gitCustomBranch: 'main',
    gitCustomDir: 'images/',
    gitCustomToken: '',
    ossAccessKey: '',
    ossSecretKey: '',
    ossBucket: '',
    ossRegion: '',
    ossEndpoint: '',
    ossCdnDomain: '',
    ossPathPrefix: '',
    picoraApiUrl: PICORA_DEFAULT_API_URL,
    picoraApiKey: '',
    picoraImgDomain: PICORA_DEFAULT_IMG_DOMAIN,
    picoraUserEmail: '',
  };
}

export function targetToConfig(target: ImageHostTarget): ImageHostConfig {
  const { id: _id, name: _name, featured: _f, picoraImportedAt: _t, ...config } = target;
  return config;
}

/** Whether this provider uses HMAC-signed object storage (Rust command) */
export function isObjectStorageProvider(provider: ImageHostProvider): boolean {
  return provider === 'qiniu' || provider === 'aliyun-oss' ||
         provider === 'tencent-cos' || provider === 'aws-s3' || provider === 'google-gcs';
}

/** Whether this provider uses Git repository hosting */
export function isGitProvider(provider: ImageHostProvider): boolean {
  return provider === 'github' || provider === 'gitlab' || provider === 'git-custom';
}
