package com.aura.assistant;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String APP_URL =
        "https://preview-chat-ee9f57e1-8e56-4ef4-871b-8e6fd69e1c5a.space-z.ai/";
    private static final int MIC_REQ = 1;

    private WebView web;
    private PermissionRequest pendingMic;
    private long apkDownloadId = -1;

    // JS bridge — the web app detects the shell via window.Robin
    class Robin {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(new Runnable() {
                public void run() {
                    web.loadUrl(APP_URL);
                }
            });
        }

        // Lets the web app show "update available" banners.
        // Format: "1.5.0 (7)" — versionName (versionCode).
        @JavascriptInterface
        public String getVersion() {
            try {
                PackageInfo p = getPackageManager()
                        .getPackageInfo(getPackageName(), 0);
                return p.versionName + " (" + p.versionCode + ")";
            } catch (Exception e) {
                return "";
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.parseColor("#0d1126"));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " ROBIN-AI/" + versionName());
        web.setBackgroundColor(Color.parseColor("#0d1126"));
        web.addJavascriptInterface(new Robin(), "Robin");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return false; // keep everything inside the app
            }

            @Override
            public void onReceivedError(WebView v, int code, String desc, String failingUrl) {
                showOfflinePage();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    public void run() {
                        for (String r : request.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                                if (checkSelfPermission("android.permission.RECORD_AUDIO")
                                        == PackageManager.PERMISSION_GRANTED) {
                                    request.grant(request.getResources());
                                } else {
                                    pendingMic = request;
                                    requestPermissions(
                                        new String[]{"android.permission.RECORD_AUDIO"},
                                        MIC_REQ);
                                }
                                return;
                            }
                        }
                    }
                });
            }
        });

        // Any download (e.g. the in-app update banner) goes through Android's
        // DownloadManager → the user gets an "open to install" notification.
        web.setDownloadListener(new DownloadListener() {
            public void onDownloadStart(String url, String ua, String cd,
                                        String mime, long len) {
                enqueueApkDownload(url);
            }
        });

        setContentView(web);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(APP_URL);
        }
        registerDownloadReceiver();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == MIC_REQ && results.length > 0
                && results[0] == PackageManager.PERMISSION_GRANTED
                && pendingMic != null) {
            pendingMic.grant(pendingMic.getResources());
        }
        pendingMic = null;
    }

    private void enqueueApkDownload(String url) {
        try {
            DownloadManager.Request req =
                    new DownloadManager.Request(Uri.parse(url));
            req.setTitle("ROBIN AI update");
            req.setDescription("Downloading the new ROBIN AI APK");
            req.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS, "ROBIN-AI.apk");
            req.setMimeType("application/vnd.android.package-archive");
            DownloadManager dm =
                    (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            apkDownloadId = dm.enqueue(req);
            Toast.makeText(this, "Downloading ROBIN update…",
                    Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            // DownloadManager unavailable — fall back to the browser
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
        }
    }

    private void registerDownloadReceiver() {
        registerReceiver(new BroadcastReceiver() {
            public void onReceive(Context ctx, Intent intent) {
                long id = intent.getLongExtra(
                        DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id == apkDownloadId) {
                    Toast.makeText(MainActivity.this,
                        "ROBIN update downloaded — pull down your "
                        + "notifications and tap ROBIN-AI.apk to install",
                        Toast.LENGTH_LONG).show();
                }
            }
        }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
    }

    private void showOfflinePage() {
        web.loadDataWithBaseURL(null,
            "<html><body style='background:#0d1126;color:#94a3b8;"
          + "font-family:sans-serif;text-align:center;padding-top:40vh'>"
          + "<div style='font-size:22px;color:#22d3ee;margin-bottom:12px'>"
          + "ROBIN AI</div>"
          + "<div style='margin-bottom:20px'>You are offline "
          + "&#183; check your connection.</div>"
          + "<button onclick='Robin.retry()' style='background:linear-gradient"
          + "(90deg,#22d3ee,#a78bfa);color:#050510;border:0;border-radius:12px;"
          + "padding:10px 26px;font-size:15px'>Retry</button>"
          + "</body></html>",
            "text/html", "utf-8", null);
    }

    private String versionName() {
        try {
            PackageInfo p = getPackageManager()
                    .getPackageInfo(getPackageName(), 0);
            return p.versionName;
        } catch (Exception e) {
            return "";
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
