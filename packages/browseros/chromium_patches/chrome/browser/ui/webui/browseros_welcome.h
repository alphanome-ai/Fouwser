diff --git a/chrome/browser/ui/webui/browseros_welcome.h b/chrome/browser/ui/webui/browseros_welcome.h
new file mode 100644
index 0000000000000..89503c57538ad
--- /dev/null
+++ b/chrome/browser/ui/webui/browseros_welcome.h
@@ -0,0 +1,356 @@
+#ifndef CHROME_BROWSER_UI_WEBUI_BROWSEROS_WELCOME_H_
+#define CHROME_BROWSER_UI_WEBUI_BROWSEROS_WELCOME_H_
+
+#include "base/memory/ref_counted_memory.h"
+#include "chrome/browser/profiles/profile.h"
+#include "content/public/browser/url_data_source.h"
+#include "content/public/browser/web_ui.h"
+#include "content/public/browser/web_ui_controller.h"
+#include "content/public/browser/webui_config.h"
+#include "services/network/public/mojom/content_security_policy.mojom.h"
+
+class BrowserOSWelcomeDataSource : public content::URLDataSource {
+ public:
+  BrowserOSWelcomeDataSource() {}
+  BrowserOSWelcomeDataSource(const BrowserOSWelcomeDataSource&) = delete;
+  BrowserOSWelcomeDataSource& operator=(const BrowserOSWelcomeDataSource&) = delete;
+
+  // URLDataSource implementation:
+  std::string GetSource() override;
+  std::string GetMimeType(const GURL& url) override;
+  std::string GetContentSecurityPolicy(network::mojom::CSPDirectiveName directive) override;
+  void StartDataRequest(const GURL& url,
+                        const content::WebContents::Getter& wc_getter,
+                        GotDataCallback callback) override;
+};
+
+std::string BrowserOSWelcomeDataSource::GetSource() {
+  return "fouwser-welcome";
+}
+
+std::string BrowserOSWelcomeDataSource::GetMimeType(const GURL& url) {
+  return "text/html";
+}
+
+std::string BrowserOSWelcomeDataSource::GetContentSecurityPolicy(network::mojom::CSPDirectiveName directive) {
+  if (directive == network::mojom::CSPDirectiveName::ScriptSrc)
+    return "'unsafe-inline'";
+  if (directive == network::mojom::CSPDirectiveName::StyleSrc)
+    return "'unsafe-inline' https://fonts.googleapis.com";
+  if (directive == network::mojom::CSPDirectiveName::FontSrc)
+    return "https://fonts.gstatic.com";
+  if (directive == network::mojom::CSPDirectiveName::ImgSrc)
+    return "'self' data:";
+  return std::string();
+}
+
+void BrowserOSWelcomeDataSource::StartDataRequest(const GURL& url,
+                                    const content::WebContents::Getter& wc_getter,
+                                    GotDataCallback callback) {
+  std::string source = R"(
+<!DOCTYPE html>
+<html lang="en">
+<head>
+  <meta charset="UTF-8">
+  <title>Welcome</title>
+  <style>
+    body {
+      display: flex;
+      justify-content: center;
+      align-items: center;
+      height: 100vh;
+      margin: 0;
+      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
+      background: #FAF7F3;
+      color: #1F1D1B;
+    }
+    h1 {
+      font-size: 3rem;
+    }
+  </style>
+</head>
+<body>
+  <h1>Welcome to Fouwser</h1>
+</body>
+</html>
+  )";
+  std::move(callback).Run(base::MakeRefCounted<base::RefCountedString>(std::move(source)));
+}
+
+class BrowserOSWelcome;
+class BrowserOSWelcomeUIConfig : public content::DefaultWebUIConfig<BrowserOSWelcome> {
+  public:
+   BrowserOSWelcomeUIConfig() : DefaultWebUIConfig("chrome", "fouwser-welcome") {}
+};
+
+class BrowserOSWelcome : public content::WebUIController {
+ public:
+  BrowserOSWelcome(content::WebUI* web_ui) : content::WebUIController(web_ui) {
+    content::URLDataSource::Add(Profile::FromWebUI(web_ui), std::make_unique<BrowserOSWelcomeDataSource>());
+  }
+  BrowserOSWelcome(const BrowserOSWelcome&) = delete;
+  BrowserOSWelcome& operator=(const BrowserOSWelcome&) = delete;
+};
+
+#endif  // CHROME_BROWSER_UI_WEBUI_BROWSEROS_WELCOME_H_
