diff --git a/chrome/common/webui_url_constants.h b/chrome/common/webui_url_constants.h
index ced6f48d16af0..8565fc5f08d6d 100644
--- a/chrome/common/webui_url_constants.h
+++ b/chrome/common/webui_url_constants.h
@@ -33,6 +33,7 @@ namespace chrome {
 // needed.
 // Please keep in alphabetical order, with OS/feature specific sections below.
 inline constexpr char kChromeUIAboutHost[] = "about";
+inline constexpr char kBrowserOSFirstRun[] = "fouwser-welcome";
 inline constexpr char kChromeUIAboutURL[] = "chrome://about/";
 inline constexpr char kChromeUIAccessCodeCastHost[] = "access-code-cast";
 inline constexpr char kChromeUIAccessCodeCastURL[] =
@@ -65,6 +66,8 @@ inline constexpr char kChromeUIBatchUploadURL[] = "chrome://batch-upload/";
 inline constexpr char kChromeUIBluetoothInternalsHost[] = "bluetooth-internals";
 inline constexpr char kChromeUIBookmarksHost[] = "bookmarks";
 inline constexpr char kChromeUIBookmarksURL[] = "chrome://bookmarks/";
+inline constexpr char kChromeUIClashOfGptsHost[] = "clash-of-gpts";
+inline constexpr char kChromeUIClashOfGptsURL[] = "chrome://clash-of-gpts/";
 inline constexpr char kChromeUIBrowsingTopicsInternalsHost[] =
     "topics-internals";
 inline constexpr char kChromeUICertificateViewerHost[] = "view-cert";
