export interface CloudApp {
  id: string
  name: string
  app_id: string
  platform: string
  organization_id: string
  created_at: string
}

export interface CloudChannel {
  id: string
  name: string
  public: boolean
  app_id: string
  environment: 'prod' | 'staging' | 'dev'
  created_at: string
}

export interface CloudFlavor {
  id: string
  name: string
  app_id: string
  config?: Record<string, unknown>
  created_at: string
}

export interface ProjectConfig {
  appId: string // com.example.app
  cloudAppId: string // uuid from cloud
  appName: string
  ghPagesRepo?: string
  createdAt: string
}

export interface CloudOrganization {
  id: string
  name: string
  slug: string
  role: 'owner' | 'admin' | 'member'
}
