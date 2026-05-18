// Google Search Console (Webmasters)
export const SCOPE_GSC_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";
export const SCOPE_GSC_FULL     = "https://www.googleapis.com/auth/webmasters";
export const SCOPE_INDEXING     = "https://www.googleapis.com/auth/indexing";

// GA4 Data + Admin API
export const SCOPE_GA4_READONLY                = "https://www.googleapis.com/auth/analytics.readonly";
export const SCOPE_GA4_EDIT                    = "https://www.googleapis.com/auth/analytics.edit";
export const SCOPE_GA4_MANAGE_USERS            = "https://www.googleapis.com/auth/analytics.manage.users";
export const SCOPE_GA4_MANAGE_USERS_READONLY   = "https://www.googleapis.com/auth/analytics.manage.users.readonly";

// GTM API v2
export const SCOPE_GTM_READONLY          = "https://www.googleapis.com/auth/tagmanager.readonly";
export const SCOPE_GTM_EDIT              = "https://www.googleapis.com/auth/tagmanager.edit.containers";
export const SCOPE_GTM_EDIT_VERSIONS     = "https://www.googleapis.com/auth/tagmanager.edit.containerversions";
export const SCOPE_GTM_PUBLISH           = "https://www.googleapis.com/auth/tagmanager.publish";
export const SCOPE_GTM_DELETE_CONTAINERS = "https://www.googleapis.com/auth/tagmanager.delete.containers";
export const SCOPE_GTM_MANAGE_ACCOUNTS   = "https://www.googleapis.com/auth/tagmanager.manage.accounts";
export const SCOPE_GTM_MANAGE_USERS      = "https://www.googleapis.com/auth/tagmanager.manage.users";

// YouTube (reserved for future phase but exposed)
export const SCOPE_YOUTUBE_READONLY                  = "https://www.googleapis.com/auth/youtube.readonly";
export const SCOPE_YOUTUBE                           = "https://www.googleapis.com/auth/youtube";
export const SCOPE_YOUTUBE_FORCE_SSL                 = "https://www.googleapis.com/auth/youtube.force-ssl";
export const SCOPE_YT_ANALYTICS_READONLY             = "https://www.googleapis.com/auth/yt-analytics.readonly";
export const SCOPE_YT_ANALYTICS_MONETARY_READONLY    = "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";

// Drive + Sheets (reserved, supplemental)
export const SCOPE_DRIVE_READONLY        = "https://www.googleapis.com/auth/drive.readonly";
export const SCOPE_DRIVE_FILE            = "https://www.googleapis.com/auth/drive.file";
export const SCOPE_DRIVE                 = "https://www.googleapis.com/auth/drive";
export const SCOPE_SPREADSHEETS          = "https://www.googleapis.com/auth/spreadsheets";
export const SCOPE_SPREADSHEETS_READONLY = "https://www.googleapis.com/auth/spreadsheets.readonly";

// Convenience scope arrays
export const ALL_GSC_SCOPES = [SCOPE_GSC_READONLY, SCOPE_GSC_FULL, SCOPE_INDEXING] as const;
export const ALL_GA4_SCOPES = [SCOPE_GA4_READONLY, SCOPE_GA4_EDIT, SCOPE_GA4_MANAGE_USERS, SCOPE_GA4_MANAGE_USERS_READONLY] as const;
export const ALL_GTM_SCOPES = [SCOPE_GTM_READONLY, SCOPE_GTM_EDIT, SCOPE_GTM_EDIT_VERSIONS, SCOPE_GTM_PUBLISH, SCOPE_GTM_DELETE_CONTAINERS, SCOPE_GTM_MANAGE_ACCOUNTS, SCOPE_GTM_MANAGE_USERS] as const;
