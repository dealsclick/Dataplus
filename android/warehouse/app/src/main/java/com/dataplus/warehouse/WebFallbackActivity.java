package com.dataplus.warehouse;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Arrays;

public final class WebFallbackActivity extends Activity {
    static final String EXTRA_PATH = "dataplus_path";
    private static final int CAMERA_REQUEST_CODE = 2417;
    private static final Uri TRUSTED_ORIGIN = Uri.parse(ApiClient.BASE_URL);

    private WebView webView;
    private PermissionRequest pendingCameraRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildScreen();
        webView.loadUrl(safeDataPlusUrl(getIntent().getStringExtra(EXTRA_PATH)));
    }

    @Override
    protected void onDestroy() {
        if (pendingCameraRequest != null) {
            pendingCameraRequest.deny();
            pendingCameraRequest = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_REQUEST_CODE || pendingCameraRequest == null) return;
        PermissionRequest request = pendingCameraRequest;
        pendingCameraRequest = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            grantVideoCapture(request);
        } else {
            request.deny();
            Toast.makeText(this, "Camera permission is needed for the web camera scanner.", Toast.LENGTH_LONG).show();
            if (!shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
                Intent settingsIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()));
                settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(settingsIntent);
            }
        }
    }

    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BACKGROUND);

        LinearLayout toolbar = Ui.row(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(Ui.dp(this, 10), Ui.dp(this, 7), Ui.dp(this, 12), Ui.dp(this, 7));
        toolbar.setBackgroundColor(Ui.SURFACE);
        toolbar.setElevation(Ui.dp(this, 3));

        TextView close = Ui.text(this, "‹", 38, Ui.TEXT, false);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("Back to native warehouse app");
        close.setBackground(Ui.rounded(0x0D000000, 99, this));
        close.setOnClickListener(view -> finish());
        toolbar.addView(close, new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 44)));

        TextView title = Ui.text(this, "DataPlus tools", 18, Ui.TEXT, true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        titleParams.setMargins(Ui.dp(this, 10), 0, 0, 0);
        toolbar.addView(title, titleParams);

        TextView webBadge = Ui.text(this, "WEB", 11, Color.WHITE, true);
        webBadge.setGravity(Gravity.CENTER);
        webBadge.setPadding(Ui.dp(this, 9), Ui.dp(this, 5), Ui.dp(this, 9), Ui.dp(this, 5));
        webBadge.setBackground(Ui.rounded(Ui.MUTED, 99, this));
        toolbar.addView(webBadge);
        root.addView(toolbar, Ui.matchWrap());

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.setBackgroundColor(Ui.BACKGROUND);
        webView.setWebViewClient(new DataPlusWebViewClient());
        webView.setWebChromeClient(new DataPlusChromeClient());
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private String safeDataPlusUrl(String requestedPath) {
        if (requestedPath == null || requestedPath.trim().isEmpty()) return ApiClient.BASE_URL + "/warehouse/mobile";
        Uri requested = Uri.parse(requestedPath.trim());
        if (requested.isAbsolute()) return isTrusted(requested) ? requested.toString() : ApiClient.BASE_URL + "/warehouse/mobile";
        String normalized = requestedPath.startsWith("/") ? requestedPath : "/" + requestedPath;
        return ApiClient.BASE_URL + normalized;
    }

    private boolean isTrusted(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
            && TRUSTED_ORIGIN.getHost().equalsIgnoreCase(uri.getHost())
            && effectivePort(TRUSTED_ORIGIN) == effectivePort(uri);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            Toast.makeText(this, "No app can open this link.", Toast.LENGTH_LONG).show();
        }
    }

    private void grantVideoCapture(PermissionRequest request) {
        if (!isTrusted(request.getOrigin())) {
            request.deny();
            return;
        }
        boolean asksForVideo = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
        if (asksForVideo) request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else request.deny();
    }

    private final class DataPlusWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isTrusted(uri)) return false;
            openExternal(uri);
            return true;
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isTrusted(uri)) return false;
            openExternal(uri);
            return true;
        }
    }

    private final class DataPlusChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!isTrusted(request.getOrigin())) {
                    request.deny();
                    return;
                }
                boolean asksForVideo = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                if (!asksForVideo) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    grantVideoCapture(request);
                    return;
                }
                if (pendingCameraRequest != null) pendingCameraRequest.deny();
                pendingCameraRequest = request;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST_CODE);
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingCameraRequest == request) pendingCameraRequest = null;
        }
    }
}
