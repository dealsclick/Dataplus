package com.dataplus.warehouse;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Typeface;
import android.media.AudioManager;
import android.media.ExifInterface;
import android.media.ToneGenerator;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Space;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.text.SimpleDateFormat;
import java.util.TimeZone;
import java.util.UUID;

public class LauncherActivity extends Activity {
    private static final String SCREEN_RECEIVING = "receiving";
    private static final String SCREEN_AUDITS = "audits";
    private static final String SCREEN_OUTBOUND = "outbound";
    private static final String SCREEN_SCANNER = "scanner";
    private static final String SCREEN_OUTBOUND_SCANNER = "outbound_scanner";
    private static final String SCREEN_MORE = "more";
    private static final int OUTBOUND_PHOTO_REQUEST = 7401;
    private static final int OUTBOUND_CAMERA_PERMISSION_REQUEST = 7403;
    private static final int OUTBOUND_PHOTO_MAX_BYTES = 1_500_000;
    private static final String PENDING_OUTBOUND_PHOTOS = "pending_outbound_photos";

    private final ApiClient api = new ApiClient();
    private final ApiClient photoApi = new ApiClient();
    private final Set<String> activePhotoUploads = new HashSet<>();
    private final ToneGenerator tones = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 75);
    private FrameLayout contentHost;
    private LinearLayout bottomNav;
    private TextView toolbarTitle;
    private TextView accountButton;
    private TextView backButton;
    private TextView offlineBanner;
    private TextView scannerStatus;
    private EditText scannerCapture;
    private String screen = "loading";
    private String dashboardMode = SCREEN_RECEIVING;
    private JSONObject user;
    private JSONObject currentAudit;
    private JSONArray audits = new JSONArray();
    private JSONArray warehouses = new JSONArray();
    private JSONArray outboundAudits = new JSONArray();
    private JSONObject currentOutboundSession;
    private JSONArray outboundScans = new JSONArray();
    private JSONObject activeOutboundPackage;
    private String pendingOutboundBarcode = "";
    private String pendingPhotoAuditId = "";
    private String pendingPhotoScanId = "";
    private String pendingPhotoTracking = "";
    private String outboundPackageFilter = "all";
    private boolean busy;
    private boolean modalOpen;
    private final StringBuilder scanBuffer = new StringBuilder();
    private final Handler scannerSubmitHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingScannerSubmit;
    private boolean updatingScannerCapture;
    private long lastScanKeyAt;
    private long lastCompletedScanAt;
    private String selectedBin = "";
    private List<JSONObject> activeBins = new ArrayList<>();
    private SharedPreferences preferences;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("warehouse_native", MODE_PRIVATE);
        configureSystemBars();
        buildShell();
        watchNetworkState();
        checkSession();
    }

    @Override
    protected void onDestroy() {
        if (connectivityManager != null && networkCallback != null) {
            try { connectivityManager.unregisterNetworkCallback(networkCallback); }
            catch (Exception ignored) {}
        }
        tones.release();
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateNetworkState();
        retryPendingOutboundPhotos();
        if (isHardwareScannerScreen()) focusScanner();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (!isHardwareScannerScreen() || modalOpen) {
            return super.dispatchKeyEvent(event);
        }
        if (event.getAction() == KeyEvent.ACTION_MULTIPLE && event.getCharacters() != null) {
            appendScannerCharacters(event.getCharacters());
            return true;
        }
        if (event.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event);
        if (event.isCtrlPressed() || event.isAltPressed() || event.isMetaPressed()) return super.dispatchKeyEvent(event);
        int keyCode = event.getKeyCode();
        boolean terminator = keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER || keyCode == KeyEvent.KEYCODE_TAB;
        if (terminator) {
            completeScannerCapture();
            return true;
        }
        int unicode = event.getUnicodeChar();
        if (unicode > 0 && !Character.isISOControl(unicode)) {
            long now = System.currentTimeMillis();
            if (now - lastScanKeyAt > 220) scanBuffer.setLength(0);
            char value = (char) unicode;
            if (Character.isLetterOrDigit(value) || value == '-' || value == ']') {
                scanBuffer.append(value);
                lastScanKeyAt = now;
                setScannerCaptureText(scanBuffer.toString());
                scheduleScannerSubmit();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        if (SCREEN_SCANNER.equals(screen)) {
            showDashboard(dashboardMode, false);
            return;
        }
        if (SCREEN_OUTBOUND_SCANNER.equals(screen)) {
            showOutboundDashboard(false);
            return;
        }
        if (!SCREEN_RECEIVING.equals(screen)) {
            showDashboard(SCREEN_RECEIVING, false);
            return;
        }
        super.onBackPressed();
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(Ui.SURFACE);
        window.setNavigationBarColor(Ui.SURFACE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    private void buildShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BACKGROUND);

        offlineBanner = Ui.text(this, "Offline — scans cannot be saved until the connection returns.", 13, Color.WHITE, true);
        offlineBanner.setGravity(Gravity.CENTER);
        offlineBanner.setBackgroundColor(Ui.ERROR);
        offlineBanner.setPadding(Ui.dp(this, 12), Ui.dp(this, 8), Ui.dp(this, 12), Ui.dp(this, 8));
        offlineBanner.setVisibility(View.GONE);
        root.addView(offlineBanner, Ui.matchWrap());

        LinearLayout toolbar = Ui.row(this);
        toolbar.setPadding(Ui.dp(this, 12), Ui.dp(this, 8), Ui.dp(this, 12), Ui.dp(this, 8));
        toolbar.setBackgroundColor(Ui.SURFACE);
        toolbar.setElevation(Ui.dp(this, 2));
        toolbar.setMinimumHeight(Ui.dp(this, 64));

        backButton = Ui.text(this, "‹", 38, Ui.TEXT, false);
        backButton.setGravity(Gravity.CENTER);
        backButton.setBackground(Ui.rounded(0x0D000000, 99, this));
        backButton.setVisibility(View.GONE);
        backButton.setOnClickListener(view -> showDashboard(dashboardMode, false));
        toolbar.addView(backButton, new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 44)));

        TextView logo = Ui.text(this, "DP", 12, Color.WHITE, true);
        logo.setGravity(Gravity.CENTER);
        logo.setBackground(Ui.rounded(Ui.TEXT, 11, this));
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40));
        logoParams.setMargins(Ui.dp(this, 6), 0, Ui.dp(this, 10), 0);
        toolbar.addView(logo, logoParams);

        toolbarTitle = Ui.text(this, "Warehouse", 20, Ui.TEXT, true);
        toolbar.addView(toolbarTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        accountButton = Ui.text(this, "Sign in", 13, Ui.TEXT, true);
        accountButton.setGravity(Gravity.CENTER);
        accountButton.setPadding(Ui.dp(this, 11), Ui.dp(this, 8), Ui.dp(this, 11), Ui.dp(this, 8));
        accountButton.setBackground(Ui.bordered(Ui.SURFACE, Ui.BORDER, 12, this));
        accountButton.setOnClickListener(this::showAccountMenu);
        toolbar.addView(accountButton);
        root.addView(toolbar, Ui.matchWrap());

        contentHost = new FrameLayout(this);
        root.addView(contentHost, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        bottomNav = Ui.row(this);
        bottomNav.setGravity(Gravity.CENTER);
        bottomNav.setPadding(Ui.dp(this, 8), Ui.dp(this, 6), Ui.dp(this, 8), Ui.dp(this, 8));
        bottomNav.setBackgroundColor(Ui.SURFACE);
        bottomNav.setElevation(Ui.dp(this, 10));
        bottomNav.addView(navItem("▣\nReceive", SCREEN_RECEIVING), new LinearLayout.LayoutParams(0, Ui.dp(this, 64), 1));
        bottomNav.addView(navItem("✓\nAudits", SCREEN_AUDITS), new LinearLayout.LayoutParams(0, Ui.dp(this, 64), 1));
        bottomNav.addView(navItem("⇥\nOutbound", SCREEN_OUTBOUND), new LinearLayout.LayoutParams(0, Ui.dp(this, 64), 1));
        bottomNav.addView(navItem("☰\nMore", SCREEN_MORE), new LinearLayout.LayoutParams(0, Ui.dp(this, 64), 1));
        bottomNav.setVisibility(View.GONE);
        root.addView(bottomNav, Ui.matchWrap());
        setContentView(root);
    }

    private TextView navItem(String label, String target) {
        TextView item = Ui.text(this, label, 12, Ui.MUTED, true);
        item.setGravity(Gravity.CENTER);
        item.setTag(target);
        item.setOnClickListener(view -> {
            if (SCREEN_MORE.equals(target)) showMore();
            else if (SCREEN_OUTBOUND.equals(target)) showOutboundDashboard(false);
            else showDashboard(target, false);
        });
        return item;
    }

    private void setScreen(View view) {
        contentHost.removeAllViews();
        contentHost.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        updateNetworkState();
    }

    private void showLoading(String message) {
        LinearLayout loading = Ui.column(this, 0);
        loading.setGravity(Gravity.CENTER);
        ProgressBar progress = new ProgressBar(this);
        loading.addView(progress, new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 44)));
        TextView text = Ui.text(this, message, 15, Ui.MUTED, false);
        LinearLayout.LayoutParams textParams = Ui.matchWrap();
        textParams.setMargins(Ui.dp(this, 24), Ui.dp(this, 16), Ui.dp(this, 24), 0);
        text.setGravity(Gravity.CENTER);
        loading.addView(text, textParams);
        setScreen(loading);
    }

    private void checkSession() {
        screen = "loading";
        bottomNav.setVisibility(View.GONE);
        backButton.setVisibility(View.GONE);
        accountButton.setVisibility(View.GONE);
        showLoading("Opening DataPlus Warehouse…");
        api.get("/api/auth/session", new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                user = response.optJSONObject("user");
                updateAccountLabel();
                showDashboard(SCREEN_RECEIVING, true);
            }
            @Override public void onError(ApiClient.ApiException error) {
                if (error.isUnauthorized()) showLogin();
                else showRetry("DataPlus could not be reached.", error.getMessage(), LauncherActivity.this::checkSession);
            }
        });
    }

    private void showLogin() {
        screen = "login";
        user = null;
        bottomNav.setVisibility(View.GONE);
        backButton.setVisibility(View.GONE);
        toolbarTitle.setText("Warehouse");
        accountButton.setVisibility(View.GONE);

        ScrollView scroll = new ScrollView(this);
        LinearLayout page = Ui.column(this, 0);
        page.setPadding(Ui.dp(this, 20), Ui.dp(this, 36), Ui.dp(this, 20), Ui.dp(this, 36));

        LinearLayout card = Ui.card(this);
        card.addView(Ui.text(this, "DataPlus Warehouse", 25, Ui.TEXT, true));
        TextView subtitle = Ui.text(this, "Native receiving, audit, and outbound scanner for the G47.", 14, Ui.MUTED, false);
        Ui.margin(subtitle, 0, 7, 0, 22);
        card.addView(subtitle);

        TextView usernameLabel = Ui.text(this, "Username", 13, Ui.TEXT, true);
        card.addView(usernameLabel);
        EditText username = input("Username", false);
        username.setText(preferences.getString("last_username", ""));
        Ui.margin(username, 0, 7, 0, 16);
        card.addView(username);

        card.addView(Ui.text(this, "Password", 13, Ui.TEXT, true));
        EditText password = input("Password", true);
        Ui.margin(password, 0, 7, 0, 18);
        card.addView(password);

        TextView errorText = Ui.text(this, "", 13, Ui.ERROR, true);
        errorText.setVisibility(View.GONE);
        Ui.margin(errorText, 0, 0, 0, 12);
        card.addView(errorText);

        Button signIn = Ui.button(this, "Sign in", true);
        signIn.setOnClickListener(view -> {
            if (busy) return;
            String login = username.getText().toString().trim();
            String secret = password.getText().toString();
            if (login.isEmpty() || secret.isEmpty()) {
                errorText.setText("Enter your username and password.");
                errorText.setVisibility(View.VISIBLE);
                return;
            }
            hideKeyboard(password);
            busy = true;
            signIn.setEnabled(false);
            signIn.setText("Signing in…");
            JSONObject body = new JSONObject();
            try { body.put("username", login).put("password", secret); } catch (Exception ignored) {}
            api.post("/api/auth/login", body, new ApiClient.Callback() {
                @Override public void onSuccess(JSONObject response) {
                    busy = false;
                    preferences.edit().putString("last_username", login).apply();
                    user = response.optJSONObject("user");
                    updateAccountLabel();
                    showDashboard(SCREEN_RECEIVING, true);
                }
                @Override public void onError(ApiClient.ApiException error) {
                    busy = false;
                    signIn.setEnabled(true);
                    signIn.setText("Sign in");
                    errorText.setText(error.getMessage());
                    errorText.setVisibility(View.VISIBLE);
                    feedback(false);
                }
            });
        });
        card.addView(signIn, Ui.matchWrap());

        TextView privacy = Ui.text(this, "Your DataPlus session stays private to this app. Warehouse writes require a network connection.", 12, Ui.MUTED, false);
        Ui.margin(privacy, 0, 18, 0, 0);
        card.addView(privacy);
        page.addView(card, Ui.matchWrap());
        scroll.addView(page);
        setScreen(scroll);
    }

    private EditText input(String hint, boolean password) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextSize(16);
        input.setTextColor(Ui.TEXT);
        input.setHintTextColor(Ui.MUTED);
        input.setSingleLine(true);
        input.setPadding(Ui.dp(this, 13), 0, Ui.dp(this, 13), 0);
        input.setMinHeight(Ui.dp(this, 52));
        input.setBackground(Ui.bordered(Ui.SURFACE, Ui.BORDER, 12, this));
        if (password) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        return input;
    }

    private void showDashboard(String mode, boolean refresh) {
        screen = mode;
        dashboardMode = mode;
        currentAudit = null;
        modalOpen = false;
        resetScanBuffer();
        bottomNav.setVisibility(View.VISIBLE);
        backButton.setVisibility(View.GONE);
        accountButton.setVisibility(View.VISIBLE);
        toolbarTitle.setText(SCREEN_RECEIVING.equals(mode) ? "Receiving" : "Warehouse audits");
        updateNavSelection(mode);
        if (refresh || audits.length() == 0) loadDashboard();
        else renderDashboard();
    }

    private void loadDashboard() {
        if (!isOnline()) {
            renderDashboard();
            return;
        }
        showLoading("Loading active warehouse work…");
        api.get("/api/warehouse-audits?summary=1&status=in_progress&pageSize=100&sort=newest", new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                audits = response.optJSONArray("audits");
                if (audits == null) audits = new JSONArray();
                api.get("/api/app/references?include=warehouses", new ApiClient.Callback() {
                    @Override public void onSuccess(JSONObject referenceResponse) {
                        warehouses = referenceResponse.optJSONArray("warehouses");
                        if (warehouses == null) warehouses = new JSONArray();
                        renderDashboard();
                    }
                    @Override public void onError(ApiClient.ApiException error) {
                        if (error.isUnauthorized()) showLogin();
                        else renderDashboard();
                    }
                });
            }
            @Override public void onError(ApiClient.ApiException error) {
                if (error.isUnauthorized()) showLogin();
                else showRetry("Unable to load warehouse work", error.getMessage(), LauncherActivity.this::loadDashboard);
            }
        });
    }

    private void renderDashboard() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout page = Ui.column(this, 0);
        page.setPadding(Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 28));

        TextView title = Ui.text(this, SCREEN_RECEIVING.equals(dashboardMode) ? "Active receiving" : "Active audits", 24, Ui.TEXT, true);
        page.addView(title);
        TextView subtitle = Ui.text(this, SCREEN_RECEIVING.equals(dashboardMode)
            ? "Choose an inbound receipt, then scan with either physical trigger."
            : "Choose a count in progress and continue scanning.", 14, Ui.MUTED, false);
        Ui.margin(subtitle, 0, 5, 0, 16);
        page.addView(subtitle);

        LinearLayout actions = Ui.row(this);
        Button start = Ui.button(this, SCREEN_RECEIVING.equals(dashboardMode) ? "Start receiving" : "Start audit", true);
        start.setOnClickListener(view -> openWeb(SCREEN_RECEIVING.equals(dashboardMode) ? "/warehouse/mobile/receiving" : "/warehouse/mobile/audits"));
        actions.addView(start, new LinearLayout.LayoutParams(0, Ui.dp(this, 50), 1));
        Button refresh = Ui.button(this, "Refresh", false);
        refresh.setOnClickListener(view -> loadDashboard());
        LinearLayout.LayoutParams refreshParams = new LinearLayout.LayoutParams(Ui.dp(this, 110), Ui.dp(this, 50));
        refreshParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        actions.addView(refresh, refreshParams);
        page.addView(actions, Ui.matchWrap());

        int shown = 0;
        for (int index = 0; index < audits.length(); index++) {
            JSONObject audit = audits.optJSONObject(index);
            if (audit == null || !"in_progress".equalsIgnoreCase(audit.optString("status"))) continue;
            boolean receiving = isReceivingReason(audit.optString("reason"));
            if (SCREEN_RECEIVING.equals(dashboardMode) != receiving) continue;
            LinearLayout auditCard = auditCard(audit);
            LinearLayout.LayoutParams params = Ui.matchWrap();
            params.setMargins(0, Ui.dp(this, shown == 0 ? 18 : 10), 0, 0);
            page.addView(auditCard, params);
            shown++;
        }
        if (shown == 0) {
            LinearLayout empty = Ui.card(this);
            TextView icon = Ui.text(this, SCREEN_RECEIVING.equals(dashboardMode) ? "▣" : "✓", 30, Ui.MUTED, false);
            icon.setGravity(Gravity.CENTER);
            empty.addView(icon, Ui.matchWrap());
            TextView emptyTitle = Ui.text(this, SCREEN_RECEIVING.equals(dashboardMode) ? "No active receipts" : "No active audits", 17, Ui.TEXT, true);
            emptyTitle.setGravity(Gravity.CENTER);
            Ui.margin(emptyTitle, 0, 8, 0, 4);
            empty.addView(emptyTitle);
            TextView emptyText = Ui.text(this, "Start one in DataPlus, then it will appear here for native scanning.", 13, Ui.MUTED, false);
            emptyText.setGravity(Gravity.CENTER);
            empty.addView(emptyText);
            LinearLayout.LayoutParams emptyParams = Ui.matchWrap();
            emptyParams.setMargins(0, Ui.dp(this, 18), 0, 0);
            page.addView(empty, emptyParams);
        }
        scroll.addView(page);
        setScreen(scroll);
    }

    private LinearLayout auditCard(JSONObject audit) {
        LinearLayout card = Ui.card(this);
        card.setClickable(true);
        card.setFocusable(true);
        card.setOnClickListener(view -> openAudit(audit.optString("id")));
        LinearLayout heading = Ui.row(this);
        String reference = auditReference(audit);
        heading.addView(Ui.text(this, reference, 18, Ui.TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        heading.addView(Ui.chip(this, reasonLabel(audit.optString("reason")), isReceivingReason(audit.optString("reason")) ? Ui.SUCCESS : Ui.PRIMARY, isReceivingReason(audit.optString("reason")) ? Ui.SUCCESS_SOFT : 0xFFEFF6FF));
        card.addView(heading);
        TextView warehouse = Ui.text(this, audit.optString("warehouseName", "Warehouse"), 14, Ui.TEXT, true);
        Ui.margin(warehouse, 0, 10, 0, 3);
        card.addView(warehouse);
        String detail = audit.optString("supplierName");
        if (!audit.optString("externalPurchaseOrderNumber").isEmpty()) detail += (detail.isEmpty() ? "" : " · ") + audit.optString("externalPurchaseOrderNumber");
        if (detail.isEmpty()) detail = "Tap to open scanner";
        card.addView(Ui.text(this, detail, 13, Ui.MUTED, false));

        JSONArray lines = audit.optJSONArray("lines");
        JSONArray unknowns = audit.optJSONArray("unknownBarcodes");
        int lineCount = audit.optInt("lineCount", lines == null ? 0 : lines.length());
        int unknownCount = audit.optInt("unknownCount", unknowns == null ? 0 : unknowns.length());
        TextView progress = Ui.text(this, lineCount + " SKU" + (lineCount == 1 ? "" : "s") + " counted" + (unknownCount > 0 ? " · " + unknownCount + " unknown" : ""), 12, Ui.MUTED, false);
        Ui.margin(progress, 0, 12, 0, 0);
        card.addView(progress);
        return card;
    }

    private void openAudit(String id) {
        if (id == null || id.trim().isEmpty()) return;
        showLoading("Opening native scanner…");
        api.get("/api/warehouse-audits/" + Uri.encode(id), new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                currentAudit = response.optJSONObject("audit");
                if (currentAudit == null) {
                    showRetry("Audit not found", "DataPlus did not return this audit.", () -> showDashboard(dashboardMode, false));
                    return;
                }
                dashboardMode = isReceivingReason(currentAudit.optString("reason")) ? SCREEN_RECEIVING : SCREEN_AUDITS;
                showScanner();
            }
            @Override public void onError(ApiClient.ApiException error) {
                if (error.isUnauthorized()) showLogin();
                else showRetry("Unable to open scanner", error.getMessage(), () -> openAudit(id));
            }
        });
    }

    private void showScanner() {
        if (currentAudit == null) return;
        screen = SCREEN_SCANNER;
        modalOpen = false;
        busy = false;
        bottomNav.setVisibility(View.GONE);
        backButton.setVisibility(View.VISIBLE);
        accountButton.setVisibility(View.VISIBLE);
        toolbarTitle.setText("Scan items");
        configureBins();

        ScrollView scroll = new ScrollView(this);
        LinearLayout page = Ui.column(this, 0);
        page.setFocusableInTouchMode(true);
        page.setPadding(Ui.dp(this, 13), Ui.dp(this, 14), Ui.dp(this, 13), Ui.dp(this, 30));

        LinearLayout auditCard = Ui.card(this);
        LinearLayout heading = Ui.row(this);
        heading.addView(Ui.text(this, auditReference(currentAudit), 18, Ui.TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        heading.addView(Ui.chip(this, "In progress", Ui.SUCCESS, Ui.SUCCESS_SOFT));
        auditCard.addView(heading);
        TextView warehouse = Ui.text(this, currentAudit.optString("warehouseName", "Warehouse"), 14, Ui.TEXT, true);
        Ui.margin(warehouse, 0, 8, 0, 3);
        auditCard.addView(warehouse);
        auditCard.addView(Ui.text(this, reasonLabel(currentAudit.optString("reason")), 13, Ui.MUTED, false));
        TextView counted = Ui.text(this, auditProgressLabel(currentAudit), 13, Ui.MUTED, true);
        Ui.margin(counted, 0, 12, 0, 0);
        auditCard.addView(counted);
        page.addView(auditCard, Ui.matchWrap());

        LinearLayout scannerCard = Ui.card(this);
        scannerCard.setBackground(Ui.bordered(Ui.SURFACE, 0xFFBFDBFE, 18, this));
        LinearLayout scannerHeading = Ui.row(this);
        TextView scannerIcon = Ui.text(this, "▣", 24, Color.WHITE, true);
        scannerIcon.setGravity(Gravity.CENTER);
        scannerIcon.setBackground(Ui.rounded(Ui.PRIMARY, 15, this));
        scannerHeading.addView(scannerIcon, new LinearLayout.LayoutParams(Ui.dp(this, 52), Ui.dp(this, 52)));
        LinearLayout scannerTitle = Ui.column(this, 0);
        LinearLayout.LayoutParams scannerTitleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        scannerTitleParams.setMargins(Ui.dp(this, 12), 0, 0, 0);
        scannerHeading.addView(scannerTitle, scannerTitleParams);
        scannerTitle.addView(Ui.text(this, "Hardware scanner ready", 17, Ui.TEXT, true));
        TextView instruction = Ui.text(this, "Press either G47 scan trigger. The item is confirmed before anything is saved.", 13, Ui.MUTED, false);
        Ui.margin(instruction, 0, 3, 0, 0);
        scannerTitle.addView(instruction);
        scannerCard.addView(scannerHeading);

        scannerCapture = scannerCaptureField("Waiting for barcode");
        LinearLayout.LayoutParams previewParams = Ui.matchWrap();
        previewParams.height = Ui.dp(this, 54);
        previewParams.setMargins(0, Ui.dp(this, 16), 0, 0);
        scannerCard.addView(scannerCapture, previewParams);

        scannerStatus = Ui.text(this, "Scanner input active · press either G47 trigger", 12, Ui.SUCCESS, true);
        Ui.margin(scannerStatus, 0, 8, 0, 0);
        scannerCard.addView(scannerStatus);

        TextView binLabel = Ui.text(this, "Current bin / location", 13, Ui.TEXT, true);
        Ui.margin(binLabel, 0, 16, 0, 6);
        scannerCard.addView(binLabel);
        Button binButton = Ui.button(this, selectedBin.isEmpty() ? "Choose bin" : "Bin " + selectedBin, false);
        binButton.setOnClickListener(view -> chooseBin());
        scannerCard.addView(binButton, Ui.matchWrap());

        LinearLayout fallbackRow = Ui.row(this);
        Button typeButton = Ui.button(this, "Type barcode", false);
        typeButton.setOnClickListener(view -> showManualBarcodeDialog());
        fallbackRow.addView(typeButton, new LinearLayout.LayoutParams(0, Ui.dp(this, 50), 1));
        Button webButton = Ui.button(this, "Camera & tools", false);
        webButton.setOnClickListener(view -> openWeb("/warehouse/mobile/audits/" + Uri.encode(currentAudit.optString("id"))));
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 50), 1);
        webParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        fallbackRow.addView(webButton, webParams);
        LinearLayout.LayoutParams fallbackParams = Ui.matchWrap();
        fallbackParams.setMargins(0, Ui.dp(this, 12), 0, 0);
        scannerCard.addView(fallbackRow, fallbackParams);

        List<JSONObject> missingUpcs = missingPurchaseOrderUpcLines();
        if (!missingUpcs.isEmpty()) {
            Button addUpc = Ui.button(this, "Add missing UPC (" + missingUpcs.size() + ")", false);
            addUpc.setOnClickListener(view -> showMissingPurchaseOrderUpcPicker());
            Ui.margin(addUpc, 0, 9, 0, 0);
            scannerCard.addView(addUpc, Ui.matchWrap());
        }

        LinearLayout.LayoutParams scannerParams = Ui.matchWrap();
        scannerParams.setMargins(0, Ui.dp(this, 12), 0, 0);
        page.addView(scannerCard, scannerParams);

        TextView recentTitle = Ui.text(this, "Recently counted", 17, Ui.TEXT, true);
        Ui.margin(recentTitle, 2, 20, 0, 8);
        page.addView(recentTitle);
        addRecentItems(page);

        scroll.addView(page);
        setScreen(scroll);
        page.requestFocus();
        focusScanner();
    }

    private void addRecentItems(LinearLayout page) {
        JSONArray lines = currentAudit.optJSONArray("lines");
        if (lines == null || lines.length() == 0) {
            LinearLayout empty = Ui.card(this);
            TextView text = Ui.text(this, "Scan the first UPC to begin.", 14, Ui.MUTED, false);
            text.setGravity(Gravity.CENTER);
            empty.addView(text, Ui.matchWrap());
            page.addView(empty, Ui.matchWrap());
            return;
        }
        int shown = 0;
        for (int index = lines.length() - 1; index >= 0 && shown < 6; index--, shown++) {
            JSONObject line = lines.optJSONObject(index);
            if (line == null) continue;
            LinearLayout card = Ui.card(this);
            LinearLayout first = Ui.row(this);
            first.addView(Ui.text(this, line.optString("sku", line.optString("barcode", "Item")), 15, Ui.TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            int quantity = Math.max(0, line.optInt("countedQty", line.optInt("count", 0)));
            first.addView(Ui.chip(this, "Qty " + quantity, Ui.PRIMARY, 0xFFEFF6FF));
            card.addView(first);
            TextView title = Ui.text(this, line.optString("title", "Counted item"), 13, Ui.MUTED, false);
            Ui.margin(title, 0, 6, 0, 0);
            card.addView(title);
            String detail = "UOM " + line.optString("uomName", line.optString("uom", "Each"));
            if (!line.optString("locationBin").isEmpty()) detail += " · Bin " + line.optString("locationBin");
            TextView metadata = Ui.text(this, detail, 12, Ui.MUTED, false);
            Ui.margin(metadata, 0, 7, 0, 0);
            card.addView(metadata);
            if ("purchase_order_receipt".equalsIgnoreCase(currentAudit.optString("reason"))
                && line.optString("catalogBarcode").trim().isEmpty()) {
                Button addUpc = Ui.button(this, "Add missing UPC", false);
                addUpc.setOnClickListener(view -> showAddPurchaseOrderUpcDialog(line));
                Ui.margin(addUpc, 0, 9, 0, 0);
                card.addView(addUpc, Ui.matchWrap());
            }
            LinearLayout.LayoutParams params = Ui.matchWrap();
            params.setMargins(0, shown == 0 ? 0 : Ui.dp(this, 8), 0, 0);
            page.addView(card, params);
        }
    }

    private List<JSONObject> missingPurchaseOrderUpcLines() {
        List<JSONObject> missing = new ArrayList<>();
        if (currentAudit == null || !"purchase_order_receipt".equalsIgnoreCase(currentAudit.optString("reason"))) return missing;
        JSONArray expected = currentAudit.optJSONArray("purchaseOrderExpectedLines");
        if (expected == null) return missing;
        for (int index = 0; index < expected.length(); index++) {
            JSONObject line = expected.optJSONObject(index);
            if (line == null || line.optString("id").trim().isEmpty() || line.optString("sku").trim().isEmpty()) continue;
            if (line.optString("catalogBarcode").trim().isEmpty()) missing.add(line);
        }
        return missing;
    }

    private void showMissingPurchaseOrderUpcPicker() {
        List<JSONObject> missing = missingPurchaseOrderUpcLines();
        if (missing.isEmpty()) {
            Toast.makeText(this, "Every PO item already has a catalog UPC.", Toast.LENGTH_SHORT).show();
            focusScanner();
            return;
        }
        if (missing.size() == 1) {
            showAddPurchaseOrderUpcDialog(missing.get(0));
            return;
        }
        String[] labels = new String[missing.size()];
        for (int index = 0; index < missing.size(); index++) {
            JSONObject line = missing.get(index);
            String title = line.optString("title", line.optString("description"));
            labels[index] = line.optString("sku") + (title.isEmpty() ? "" : " — " + title);
        }
        boolean[] selected = new boolean[]{false};
        modalOpen = true;
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Choose the PO item")
            .setMessage("Select the item, then scan the UPC printed on the product.")
            .setItems(labels, (value, which) -> {
                selected[0] = true;
                modalOpen = false;
                value.dismiss();
                scannerSubmitHandler.post(() -> showAddPurchaseOrderUpcDialog(missing.get(which)));
            })
            .setNegativeButton("Cancel", null)
            .create();
        dialog.setOnDismissListener(value -> {
            if (!selected[0]) {
                modalOpen = false;
                focusScanner();
            }
        });
        dialog.show();
    }

    private void showAddPurchaseOrderUpcDialog(JSONObject line) {
        if (line == null || currentAudit == null) return;
        modalOpen = true;
        EditText upcInput = input("Scan or type UPC", false);
        upcInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        upcInput.setSingleLine(true);
        TextView error = Ui.text(this, "", 13, Ui.ERROR, true);
        error.setVisibility(View.GONE);
        LinearLayout wrapper = Ui.column(this, 0);
        wrapper.setPadding(Ui.dp(this, 20), Ui.dp(this, 4), Ui.dp(this, 20), 0);
        wrapper.addView(Ui.text(this, line.optString("sku", "PO item"), 16, Ui.TEXT, true), Ui.matchWrap());
        String title = line.optString("title", line.optString("description"));
        if (!title.isEmpty()) {
            TextView titleView = Ui.text(this, title, 13, Ui.MUTED, false);
            Ui.margin(titleView, 0, 4, 0, 10);
            wrapper.addView(titleView, Ui.matchWrap());
        }
        wrapper.addView(upcInput, Ui.matchWrap());
        Ui.margin(error, 0, 8, 0, 0);
        wrapper.addView(error, Ui.matchWrap());
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Add missing UPC")
            .setMessage("Scan the 8, 12, 13, or 14 digit UPC. DataPlus will reject a UPC already assigned to another SKU.")
            .setView(wrapper)
            .setPositiveButton("Save UPC", null)
            .setNegativeButton("Cancel", null)
            .create();
        dialog.setOnDismissListener(value -> {
            modalOpen = false;
            busy = false;
            focusScanner();
        });
        dialog.setOnShowListener(value -> {
            Button save = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            save.setOnClickListener(view -> {
                String upc = upcInput.getText().toString().replaceAll("\\D", "");
                if (!(upc.length() == 8 || upc.length() == 12 || upc.length() == 13 || upc.length() == 14)) {
                    error.setText("Scan or enter a valid 8, 12, 13, or 14 digit UPC.");
                    error.setVisibility(View.VISIBLE);
                    return;
                }
                String lineKey = line.optString("id").trim();
                if (lineKey.isEmpty()) {
                    error.setText("This PO line is missing its DataPlus identifier. Refresh the receiving session.");
                    error.setVisibility(View.VISIBLE);
                    return;
                }
                busy = true;
                save.setEnabled(false);
                save.setText("Saving…");
                JSONObject body = new JSONObject();
                try {
                    body.put("upc", upc);
                    body.put("user", user == null ? "Warehouse" : user.optString("name", user.optString("username", "Warehouse")));
                } catch (Exception ignored) {}
                api.post("/api/warehouse-audits/" + Uri.encode(currentAudit.optString("id")) + "/lines/" + Uri.encode(lineKey) + "/upc", body, new ApiClient.Callback() {
                    @Override public void onSuccess(JSONObject response) {
                        busy = false;
                        JSONObject audit = response.optJSONObject("audit");
                        if (audit != null) currentAudit = audit;
                        feedback(true);
                        Toast.makeText(LauncherActivity.this, response.optString("message", "UPC saved."), Toast.LENGTH_SHORT).show();
                        dialog.dismiss();
                        showScanner();
                    }
                    @Override public void onError(ApiClient.ApiException apiError) {
                        busy = false;
                        if (apiError.isUnauthorized()) {
                            dialog.dismiss();
                            showLogin();
                            return;
                        }
                        feedback(false);
                        error.setText(apiError.getMessage());
                        error.setVisibility(View.VISIBLE);
                        save.setEnabled(true);
                        save.setText("Save UPC");
                    }
                });
            });
            upcInput.requestFocus();
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        });
        dialog.show();
    }

    private void configureBins() {
        activeBins = new ArrayList<>();
        JSONObject warehouse = selectedWarehouse();
        JSONArray bins = warehouse == null ? null : warehouse.optJSONArray("bins");
        if (bins != null) {
            for (int index = 0; index < bins.length(); index++) {
                JSONObject bin = bins.optJSONObject(index);
                if (bin != null && bin.optBoolean("active", true) && !bin.optString("code").trim().isEmpty()) activeBins.add(bin);
            }
        }
        String auditId = currentAudit.optString("id");
        String saved = preferences.getString("bin_" + auditId, "");
        selectedBin = saved == null ? "" : saved;
        if (!selectedBin.isEmpty() && activeBins.stream().noneMatch(bin -> selectedBin.equals(bin.optString("code")))) selectedBin = "";
        if (selectedBin.isEmpty() && !activeBins.isEmpty()) {
            JSONObject preferred = activeBins.stream().filter(bin -> bin.optBoolean("isDefault", false)).findFirst().orElse(activeBins.get(0));
            selectedBin = preferred.optString("code");
        }
    }

    private JSONObject selectedWarehouse() {
        if (currentAudit == null) return null;
        String id = currentAudit.optString("warehouseId");
        String name = currentAudit.optString("warehouseName");
        for (int index = 0; index < warehouses.length(); index++) {
            JSONObject warehouse = warehouses.optJSONObject(index);
            if (warehouse == null) continue;
            if (!id.isEmpty() && id.equals(warehouse.optString("id"))) return warehouse;
            if (!name.isEmpty() && name.equalsIgnoreCase(warehouse.optString("name"))) return warehouse;
        }
        return null;
    }

    private boolean binRequired() {
        JSONObject warehouse = selectedWarehouse();
        return warehouse != null && warehouse.optBoolean("requireBinValidation", false);
    }

    private void chooseBin() {
        modalOpen = true;
        if (!activeBins.isEmpty()) {
            String[] labels = new String[activeBins.size()];
            int selectedIndex = -1;
            for (int index = 0; index < activeBins.size(); index++) {
                JSONObject bin = activeBins.get(index);
                labels[index] = bin.optString("code") + (bin.optString("name").isEmpty() ? "" : " — " + bin.optString("name"));
                if (selectedBin.equals(bin.optString("code"))) selectedIndex = index;
            }
            AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Choose warehouse bin")
                .setSingleChoiceItems(labels, selectedIndex, (value, which) -> {
                    selectedBin = activeBins.get(which).optString("code");
                    saveSelectedBin();
                    value.dismiss();
                    modalOpen = false;
                    showScanner();
                })
                .setNegativeButton("Cancel", null)
                .create();
            dialog.setOnDismissListener(value -> { modalOpen = false; focusScanner(); });
            dialog.show();
            return;
        }
        EditText input = input("Bin or location", false);
        input.setText(selectedBin);
        LinearLayout wrapper = Ui.column(this, 0);
        wrapper.setPadding(Ui.dp(this, 20), Ui.dp(this, 4), Ui.dp(this, 20), 0);
        wrapper.addView(input, Ui.matchWrap());
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Bin or location")
            .setMessage(binRequired() ? "This warehouse requires a valid configured bin." : "Enter the location saved with the next scan.")
            .setView(wrapper)
            .setPositiveButton("Use location", (value, which) -> {
                selectedBin = input.getText().toString().trim();
                saveSelectedBin();
                modalOpen = false;
                showScanner();
            })
            .setNegativeButton("Cancel", null)
            .create();
        dialog.setOnDismissListener(value -> { modalOpen = false; focusScanner(); });
        dialog.show();
    }

    private void saveSelectedBin() {
        if (currentAudit != null) preferences.edit().putString("bin_" + currentAudit.optString("id"), selectedBin).apply();
    }

    private void showManualBarcodeDialog() {
        modalOpen = true;
        EditText input = input("SKU or UPC", false);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        LinearLayout wrapper = Ui.column(this, 0);
        wrapper.setPadding(Ui.dp(this, 20), Ui.dp(this, 4), Ui.dp(this, 20), 0);
        wrapper.addView(input, Ui.matchWrap());
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Type a barcode")
            .setView(wrapper)
            .setPositiveButton("Look up", (value, which) -> {
                String barcode = input.getText().toString().trim();
                modalOpen = false;
                if (!barcode.isEmpty()) lookupBarcode(barcode);
            })
            .setNegativeButton("Cancel", null)
            .create();
        dialog.setOnDismissListener(value -> { modalOpen = false; focusScanner(); });
        dialog.setOnShowListener(value -> {
            input.requestFocus();
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        });
        dialog.show();
    }

    private void lookupBarcode(String rawBarcode) {
        String barcode = normalizedScannerValue(rawBarcode);
        if (barcode.isEmpty() || currentAudit == null || busy) return;
        if (!isOnline()) {
            scannerMessage("Offline — reconnect before scanning.", false);
            feedback(false);
            return;
        }
        if (binRequired() && selectedBin.isEmpty()) {
            scannerMessage("Choose a valid bin before scanning.", false);
            feedback(false);
            chooseBin();
            return;
        }
        busy = true;
        scannerMessage("Looking up " + barcode + "…", true);
        JSONObject body = new JSONObject();
        try { body.put("barcode", barcode); } catch (Exception ignored) {}
        api.post("/api/warehouse-audits/" + Uri.encode(currentAudit.optString("id")) + "/lookup", body, new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                busy = false;
                if (response.optBoolean("matched", false)) {
                    feedback(true);
                    showScanConfirmation(barcode, response);
                } else {
                    feedback(false);
                    showUnknownBarcode(barcode, response.optString("message", "Product not found."));
                }
            }
            @Override public void onError(ApiClient.ApiException error) {
                busy = false;
                if (error.isUnauthorized()) showLogin();
                else {
                    scannerMessage(error.getMessage(), false);
                    feedback(false);
                    focusScanner();
                }
            }
        });
    }

    private void showScanConfirmation(String barcode, JSONObject response) {
        JSONObject product = response.optJSONObject("product");
        if (product == null) {
            showUnknownBarcode(barcode, "Product details were not returned.");
            return;
        }
        modalOpen = true;
        Dialog dialog = bottomDialog();
        LinearLayout sheet = Ui.column(this, 0);
        sheet.setPadding(Ui.dp(this, 20), Ui.dp(this, 12), Ui.dp(this, 20), Ui.dp(this, 24));
        sheet.setBackground(Ui.rounded(Ui.SURFACE, 24, this));

        View handle = new View(this);
        handle.setBackground(Ui.rounded(0xFFD1D5DB, 99, this));
        LinearLayout.LayoutParams handleParams = new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 5));
        handleParams.gravity = Gravity.CENTER_HORIZONTAL;
        sheet.addView(handle, handleParams);

        TextView title = Ui.text(this, "Confirm scanned item", 20, Ui.TEXT, true);
        Ui.margin(title, 0, 17, 0, 4);
        sheet.addView(title);
        sheet.addView(Ui.text(this, response.optString("message", "Confirm the receiving quantity."), 14, Ui.MUTED, false));

        LinearLayout productCard = Ui.card(this);
        productCard.setBackground(Ui.bordered(0xFFF0FDF4, 0xFFA7F3D0, 16, this));
        LinearLayout productHeader = Ui.row(this);
        productHeader.addView(Ui.text(this, product.optString("sku", barcode), 18, Ui.TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        productHeader.addView(Ui.chip(this, response.optBoolean("catalogResolved", true) ? "Matched" : "PO matched", Ui.SUCCESS, Ui.SUCCESS_SOFT));
        productCard.addView(productHeader);
        TextView productTitle = Ui.text(this, product.optString("title", "Catalog item"), 14, Ui.MUTED, false);
        Ui.margin(productTitle, 0, 7, 0, 8);
        productCard.addView(productTitle);
        if (!barcode.equals(product.optString("sku"))) productCard.addView(Ui.text(this, "Scanned " + barcode, 12, Ui.MUTED, false));
        LinearLayout.LayoutParams productParams = Ui.matchWrap();
        productParams.setMargins(0, Ui.dp(this, 16), 0, 0);
        sheet.addView(productCard, productParams);

        LinearLayout facts = Ui.row(this);
        facts.addView(factCard("Unit of measure", product.optString("uomName", "Each") + " (" + product.optString("uom", "EA") + ")"), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        View spacer = new Space(this);
        facts.addView(spacer, new LinearLayout.LayoutParams(Ui.dp(this, 8), 1));
        facts.addView(factCard("Case pack", String.valueOf(Math.max(1, product.optInt("casePack", 1)))), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout.LayoutParams factsParams = Ui.matchWrap();
        factsParams.setMargins(0, Ui.dp(this, 10), 0, 0);
        sheet.addView(facts, factsParams);

        TextView quantityLabel = Ui.text(this, isReceivingReason(currentAudit.optString("reason")) ? "Quantity to receive" : "Counted quantity", 16, Ui.TEXT, true);
        Ui.margin(quantityLabel, 0, 20, 0, 3);
        sheet.addView(quantityLabel);
        String binNote = selectedBin.isEmpty() ? "Confirm before this scan changes the audit." : "Bin " + selectedBin + " · confirm before saving.";
        sheet.addView(Ui.text(this, binNote, 12, Ui.MUTED, false));

        LinearLayout quantityRow = Ui.row(this);
        Button minus = Ui.button(this, "−", false);
        quantityRow.addView(minus, new LinearLayout.LayoutParams(Ui.dp(this, 54), Ui.dp(this, 54)));
        EditText quantity = input("1", false);
        quantity.setText("1");
        quantity.setGravity(Gravity.CENTER);
        quantity.setTextSize(19);
        quantity.setTypeface(Typeface.DEFAULT_BOLD);
        quantity.setInputType(InputType.TYPE_CLASS_NUMBER);
        LinearLayout.LayoutParams quantityParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 54), 1);
        quantityParams.setMargins(Ui.dp(this, 8), 0, Ui.dp(this, 8), 0);
        quantityRow.addView(quantity, quantityParams);
        Button plus = Ui.button(this, "+", false);
        quantityRow.addView(plus, new LinearLayout.LayoutParams(Ui.dp(this, 54), Ui.dp(this, 54)));
        Ui.margin(quantityRow, 0, 13, 0, 0);
        sheet.addView(quantityRow);
        minus.setOnClickListener(view -> quantity.setText(String.valueOf(Math.max(1, parseQuantity(quantity) - 1))));
        plus.setOnClickListener(view -> quantity.setText(String.valueOf(Math.min(100000, parseQuantity(quantity) + 1))));

        TextView errorText = Ui.text(this, "", 13, Ui.ERROR, true);
        errorText.setVisibility(View.GONE);
        Ui.margin(errorText, 0, 10, 0, 0);
        sheet.addView(errorText);

        LinearLayout actions = Ui.row(this);
        Button cancel = Ui.button(this, "Cancel", false);
        actions.addView(cancel, new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1));
        Button confirm = Ui.button(this, isReceivingReason(currentAudit.optString("reason")) ? "Receive quantity" : "Add count", true);
        LinearLayout.LayoutParams confirmParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1);
        confirmParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        actions.addView(confirm, confirmParams);
        Ui.margin(actions, 0, 18, 0, 0);
        sheet.addView(actions);
        cancel.setOnClickListener(view -> dialog.dismiss());
        confirm.setOnClickListener(view -> {
            int count = parseQuantity(quantity);
            if (count < 1) {
                errorText.setText("Enter a quantity of at least 1.");
                errorText.setVisibility(View.VISIBLE);
                return;
            }
            cancel.setEnabled(false);
            confirm.setEnabled(false);
            confirm.setText("Saving…");
            saveScan(barcode, count, dialog, errorText, cancel, confirm);
        });

        dialog.setContentView(sheet);
        dialog.setOnDismissListener(value -> {
            modalOpen = false;
            busy = false;
            focusScanner();
        });
        dialog.show();
        sizeBottomDialog(dialog);
    }

    private LinearLayout factCard(String label, String value) {
        LinearLayout card = Ui.column(this, 0);
        card.setPadding(Ui.dp(this, 12), Ui.dp(this, 11), Ui.dp(this, 12), Ui.dp(this, 11));
        card.setBackground(Ui.rounded(0xFFF8FAFC, 13, this));
        card.addView(Ui.text(this, label, 11, Ui.MUTED, false));
        TextView valueText = Ui.text(this, value, 15, Ui.TEXT, true);
        Ui.margin(valueText, 0, 4, 0, 0);
        card.addView(valueText);
        return card;
    }

    private int parseQuantity(EditText input) {
        try { return Math.max(1, Math.min(100000, Integer.parseInt(input.getText().toString().trim()))); }
        catch (Exception ignored) { return 1; }
    }

    private void saveScan(String barcode, int quantity, Dialog dialog, TextView errorText, Button cancel, Button confirm) {
        busy = true;
        JSONObject body = new JSONObject();
        try {
            body.put("barcode", barcode);
            body.put("quantity", quantity);
            body.put("locationBin", selectedBin);
            body.put("user", user == null ? "Warehouse" : user.optString("name", user.optString("username", "Warehouse")));
        } catch (Exception ignored) {}
        api.post("/api/warehouse-audits/" + Uri.encode(currentAudit.optString("id")) + "/scan", body, new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                busy = false;
                JSONObject audit = response.optJSONObject("audit");
                if (audit != null) currentAudit = audit;
                feedback(true);
                Toast.makeText(LauncherActivity.this, response.optString("message", "Scan saved."), Toast.LENGTH_SHORT).show();
                dialog.dismiss();
                showScanner();
            }
            @Override public void onError(ApiClient.ApiException error) {
                busy = false;
                if (error.isUnauthorized()) {
                    dialog.dismiss();
                    showLogin();
                    return;
                }
                feedback(false);
                errorText.setText(error.getMessage());
                errorText.setVisibility(View.VISIBLE);
                cancel.setEnabled(true);
                confirm.setEnabled(true);
                confirm.setText(isReceivingReason(currentAudit.optString("reason")) ? "Receive quantity" : "Add count");
            }
        });
    }

    private void showUnknownBarcode(String barcode, String message) {
        modalOpen = true;
        Dialog dialog = bottomDialog();
        LinearLayout sheet = Ui.column(this, 0);
        sheet.setPadding(Ui.dp(this, 20), Ui.dp(this, 12), Ui.dp(this, 20), Ui.dp(this, 24));
        sheet.setBackground(Ui.rounded(Ui.SURFACE, 24, this));
        View handle = new View(this);
        handle.setBackground(Ui.rounded(0xFFD1D5DB, 99, this));
        LinearLayout.LayoutParams handleParams = new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 5));
        handleParams.gravity = Gravity.CENTER_HORIZONTAL;
        sheet.addView(handle, handleParams);
        TextView title = Ui.text(this, "Product not found", 20, Ui.TEXT, true);
        Ui.margin(title, 0, 17, 0, 5);
        sheet.addView(title);
        sheet.addView(Ui.text(this, message, 14, Ui.MUTED, false));
        TextView code = Ui.text(this, barcode, 18, Ui.WARNING, true);
        code.setTypeface(Typeface.MONOSPACE);
        code.setPadding(Ui.dp(this, 14), Ui.dp(this, 14), Ui.dp(this, 14), Ui.dp(this, 14));
        code.setBackground(Ui.bordered(Ui.WARNING_SOFT, 0xFFFCD34D, 14, this));
        Ui.margin(code, 0, 16, 0, 0);
        sheet.addView(code);
        TextView note = Ui.text(this, "Nothing was received. Skip it or use the full DataPlus workflow to research or create the item.", 13, Ui.MUTED, false);
        Ui.margin(note, 0, 14, 0, 0);
        sheet.addView(note);
        LinearLayout actions = Ui.row(this);
        Button skip = Ui.button(this, "Skip", false);
        actions.addView(skip, new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1));
        Button full = Ui.button(this, "Open full workflow", true);
        LinearLayout.LayoutParams fullParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1);
        fullParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        actions.addView(full, fullParams);
        Ui.margin(actions, 0, 18, 0, 0);
        sheet.addView(actions);
        skip.setOnClickListener(view -> dialog.dismiss());
        full.setOnClickListener(view -> {
            dialog.dismiss();
            openWeb("/warehouse/mobile/audits/" + Uri.encode(currentAudit.optString("id")));
        });
        dialog.setContentView(sheet);
        dialog.setOnDismissListener(value -> { modalOpen = false; focusScanner(); });
        dialog.show();
        sizeBottomDialog(dialog);
    }

    private void showOutboundDashboard(boolean refresh) {
        screen = SCREEN_OUTBOUND;
        dashboardMode = SCREEN_OUTBOUND;
        currentAudit = null;
        currentOutboundSession = null;
        outboundScans = new JSONArray();
        activeOutboundPackage = null;
        pendingOutboundBarcode = "";
        modalOpen = false;
        resetScanBuffer();
        bottomNav.setVisibility(View.VISIBLE);
        backButton.setVisibility(View.GONE);
        accountButton.setVisibility(View.VISIBLE);
        toolbarTitle.setText("Outbound");
        updateNavSelection(SCREEN_OUTBOUND);
        if (refresh || outboundAudits.length() == 0) loadOutboundDashboard();
        else renderOutboundDashboard();
    }

    private void loadOutboundDashboard() {
        if (!isOnline()) {
            renderOutboundDashboard();
            return;
        }
        showLoading("Loading outbound handoffs…");
        api.get("/api/fulfillment/outbound-audits?limit=100", new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                outboundAudits = response.optJSONArray("audits");
                if (outboundAudits == null) outboundAudits = new JSONArray();
                if (warehouses.length() > 0) {
                    renderOutboundDashboard();
                    return;
                }
                api.get("/api/app/references?include=warehouses", new ApiClient.Callback() {
                    @Override public void onSuccess(JSONObject referenceResponse) {
                        warehouses = referenceResponse.optJSONArray("warehouses");
                        if (warehouses == null) warehouses = new JSONArray();
                        renderOutboundDashboard();
                    }
                    @Override public void onError(ApiClient.ApiException error) { renderOutboundDashboard(); }
                });
            }
            @Override public void onError(ApiClient.ApiException error) {
                if (error.isUnauthorized()) showLogin();
                else showRetry("Unable to load outbound handoffs", error.getMessage(), LauncherActivity.this::loadOutboundDashboard);
            }
        });
    }

    private void renderOutboundDashboard() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout page = Ui.column(this, 0);
        page.setPadding(Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 28));

        page.addView(Ui.text(this, "Outbound handoffs", 24, Ui.TEXT, true));
        TextView subtitle = Ui.text(this, "Scan every shipping label with the G47 before the packages leave the warehouse.", 14, Ui.MUTED, false);
        Ui.margin(subtitle, 0, 5, 0, 16);
        page.addView(subtitle);

        LinearLayout scannerCard = Ui.card(this);
        scannerCard.setBackground(Ui.bordered(Ui.SURFACE, 0xFFBFDBFE, 18, this));
        scannerCard.addView(Ui.text(this, "Scan to open a handoff", 17, Ui.TEXT, true));
        TextView scannerHelp = Ui.text(this, "Press either G47 trigger. The app will open the available outbound audit and process the label.", 13, Ui.MUTED, false);
        Ui.margin(scannerHelp, 0, 4, 0, 0);
        scannerCard.addView(scannerHelp);
        scannerCapture = scannerCaptureField("Waiting for tracking barcode");
        LinearLayout.LayoutParams dashboardPreviewParams = Ui.matchWrap();
        dashboardPreviewParams.height = Ui.dp(this, 52);
        dashboardPreviewParams.setMargins(0, Ui.dp(this, 14), 0, 0);
        scannerCard.addView(scannerCapture, dashboardPreviewParams);
        scannerStatus = Ui.text(this, "Scanner input active · press either G47 trigger", 12, Ui.SUCCESS, true);
        Ui.margin(scannerStatus, 0, 8, 0, 0);
        scannerCard.addView(scannerStatus);
        LinearLayout.LayoutParams dashboardScannerParams = Ui.matchWrap();
        dashboardScannerParams.setMargins(0, 0, 0, Ui.dp(this, 14));
        page.addView(scannerCard, dashboardScannerParams);

        LinearLayout actions = Ui.row(this);
        Button start = Ui.button(this, "Use current audit", true);
        start.setOnClickListener(view -> showStartOutboundDialog());
        actions.addView(start, new LinearLayout.LayoutParams(0, Ui.dp(this, 50), 1));
        Button refresh = Ui.button(this, "Refresh", false);
        refresh.setOnClickListener(view -> loadOutboundDashboard());
        LinearLayout.LayoutParams refreshParams = new LinearLayout.LayoutParams(Ui.dp(this, 110), Ui.dp(this, 50));
        refreshParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        actions.addView(refresh, refreshParams);
        page.addView(actions, Ui.matchWrap());

        int shown = 0;
        for (int index = 0; index < outboundAudits.length() && shown < 12; index++) {
            JSONObject audit = outboundAudits.optJSONObject(index);
            if (audit == null) continue;
            LinearLayout card = outboundAuditCard(audit);
            LinearLayout.LayoutParams params = Ui.matchWrap();
            params.setMargins(0, Ui.dp(this, shown == 0 ? 18 : 10), 0, 0);
            page.addView(card, params);
            shown++;
        }
        if (shown == 0) {
            LinearLayout empty = Ui.card(this);
            TextView icon = Ui.text(this, "⇥", 32, Ui.MUTED, false);
            icon.setGravity(Gravity.CENTER);
            empty.addView(icon, Ui.matchWrap());
            TextView title = Ui.text(this, "No outbound audits yet", 17, Ui.TEXT, true);
            title.setGravity(Gravity.CENTER);
            Ui.margin(title, 0, 8, 0, 4);
            empty.addView(title);
            TextView detail = Ui.text(this, "Start the current operating session, then scan package tracking labels natively.", 13, Ui.MUTED, false);
            detail.setGravity(Gravity.CENTER);
            empty.addView(detail);
            LinearLayout.LayoutParams params = Ui.matchWrap();
            params.setMargins(0, Ui.dp(this, 18), 0, 0);
            page.addView(empty, params);
        }
        scroll.addView(page);
        setScreen(scroll);
        page.requestFocus();
        focusScanner();
    }

    private List<JSONObject> openOutboundAudits() {
        List<JSONObject> open = new ArrayList<>();
        for (int index = 0; index < outboundAudits.length(); index++) {
            JSONObject audit = outboundAudits.optJSONObject(index);
            if (audit != null && "open".equalsIgnoreCase(audit.optString("status"))) open.add(audit);
        }
        return open;
    }

    private List<JSONObject> physicalWarehouses() {
        List<JSONObject> physical = new ArrayList<>();
        for (int index = 0; index < warehouses.length(); index++) {
            JSONObject warehouse = warehouses.optJSONObject(index);
            if (warehouse != null && isPhysicalWarehouse(warehouse)) physical.add(warehouse);
        }
        return physical;
    }

    private void routeOutboundDashboardScan(String rawBarcode) {
        routeOutboundDashboardScan(rawBarcode, false);
    }

    private void routeOutboundDashboardScan(String rawBarcode, boolean allowUnrecognizedTracking) {
        String barcode = normalizedScannerValue(rawBarcode);
        if (barcode.isEmpty() || busy) return;
        if (!allowUnrecognizedTracking && !isLikelyOutboundTracking(barcode)) {
            rejectNonTrackingBarcode(barcode);
            return;
        }
        if (!isOnline()) {
            scannerMessage("Offline — reconnect before scanning.", false);
            feedback(false);
            return;
        }
        pendingOutboundBarcode = barcode;
        scannerMessage("Opening handoff for " + barcode + "…", true);
        List<JSONObject> open = openOutboundAudits();
        if (open.size() == 1) {
            openOutboundAudit(open.get(0).optString("id"));
            return;
        }
        if (open.size() > 1) {
            chooseOutboundAuditForPendingScan(open);
            return;
        }
        List<JSONObject> physical = physicalWarehouses();
        if (physical.size() == 1) {
            startOutboundAudit(physical.get(0));
            return;
        }
        showStartOutboundDialog();
    }

    private void chooseOutboundAuditForPendingScan(List<JSONObject> open) {
        String[] labels = new String[open.size()];
        for (int index = 0; index < open.size(); index++) {
            JSONObject audit = open.get(index);
            labels[index] = outboundAuditReference(audit) + " · " + audit.optString("warehouseName", "Warehouse");
        }
        boolean[] selected = new boolean[]{false};
        modalOpen = true;
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Choose the outbound handoff")
            .setMessage("The label is ready. Choose which open handoff should receive it.")
            .setItems(labels, (value, which) -> {
                selected[0] = true;
                modalOpen = false;
                openOutboundAudit(open.get(which).optString("id"));
            })
            .setNegativeButton("Cancel", null)
            .create();
        dialog.setOnDismissListener(value -> {
            modalOpen = false;
            if (!selected[0]) {
                pendingOutboundBarcode = "";
                resetScanBuffer();
                focusScanner();
            }
        });
        dialog.show();
    }

    private LinearLayout outboundAuditCard(JSONObject audit) {
        boolean open = "open".equalsIgnoreCase(audit.optString("status"));
        LinearLayout card = Ui.card(this);
        card.setClickable(true);
        card.setFocusable(true);
        card.setOnClickListener(view -> {
            if (open) openOutboundAudit(audit.optString("id"));
            else openWeb("/warehouse/outbound");
        });
        LinearLayout heading = Ui.row(this);
        heading.addView(Ui.text(this, outboundAuditReference(audit), 18, Ui.TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        heading.addView(Ui.chip(this, open ? "Open" : "Closed", open ? Ui.WARNING : Ui.SUCCESS, open ? Ui.WARNING_SOFT : Ui.SUCCESS_SOFT));
        card.addView(heading);
        TextView sessionDate = Ui.text(this, (audit.optBoolean("isCurrentOperatingSession") ? "Current · " : "Operating date · ") + outboundSessionDate(audit), 12, open ? Ui.PRIMARY : Ui.MUTED, true);
        Ui.margin(sessionDate, 0, 7, 0, 0);
        card.addView(sessionDate);
        TextView warehouse = Ui.text(this, audit.optString("warehouseName", "Warehouse"), 14, Ui.TEXT, true);
        Ui.margin(warehouse, 0, 9, 0, 3);
        card.addView(warehouse);
        card.addView(Ui.text(this, "Operating mixed-carrier session", 13, Ui.MUTED, false));
        String counts = audit.optInt("packageCount") + " package" + (audit.optInt("packageCount") == 1 ? "" : "s")
            + " · " + audit.optInt("matchedCount") + " matched";
        if (audit.optInt("pendingMatchCount") > 0) counts += " · " + audit.optInt("pendingMatchCount") + " matching";
        if (audit.optInt("unmatchedCount") > 0) counts += " · " + audit.optInt("unmatchedCount") + " unmatched";
        TextView progress = Ui.text(this, counts, 12, audit.optInt("unmatchedCount") > 0 ? Ui.WARNING : Ui.MUTED, false);
        Ui.margin(progress, 0, 12, 0, 0);
        card.addView(progress);
        return card;
    }

    private void showStartOutboundDialog() {
        List<JSONObject> physical = physicalWarehouses();
        if (physical.isEmpty()) {
            Toast.makeText(this, "No active physical warehouse is available.", Toast.LENGTH_LONG).show();
            return;
        }
        String[] names = new String[physical.size()];
        for (int index = 0; index < physical.size(); index++) names[index] = warehouseName(physical.get(index));
        modalOpen = true;
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(pendingOutboundBarcode.isEmpty() ? "Use current outbound audit" : "Choose warehouse for scanned package")
            .setItems(names, (value, which) -> startOutboundAudit(physical.get(which)))
            .setNegativeButton("Cancel", null)
            .create();
        dialog.setOnDismissListener(value -> {
            modalOpen = false;
            if (SCREEN_OUTBOUND.equals(screen) && !busy) {
                pendingOutboundBarcode = "";
                resetScanBuffer();
                focusScanner();
            }
        });
        dialog.show();
    }

    private void startOutboundAudit(JSONObject warehouse) {
        if (busy || !isOnline()) return;
        busy = true;
        showLoading("Opening current outbound audit…");
        JSONObject body = new JSONObject();
        try {
            body.put("warehouseId", warehouse.optString("id"));
            body.put("warehouseName", warehouseName(warehouse));
            body.put("carrier", "");
            body.put("notes", "Started from the Warehouse Android app");
        } catch (Exception ignored) {}
        api.post("/api/fulfillment/outbound-audits", body, new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                busy = false;
                JSONObject audit = response.optJSONObject("audit");
                if (audit == null || audit.optString("id").isEmpty()) {
                    showRetry("Outbound audit unavailable", "DataPlus did not return an audit.", LauncherActivity.this::loadOutboundDashboard);
                    return;
                }
                Toast.makeText(LauncherActivity.this, response.optString("message", "Outbound audit ready."), Toast.LENGTH_SHORT).show();
                openOutboundAudit(audit.optString("id"));
            }
            @Override public void onError(ApiClient.ApiException error) {
                busy = false;
                if (error.isUnauthorized()) showLogin();
                else showRetry("Unable to start outbound audit", error.getMessage(), LauncherActivity.this::loadOutboundDashboard);
            }
        });
    }

    private void openOutboundAudit(String auditId) {
        if (auditId == null || auditId.trim().isEmpty()) return;
        showLoading("Opening outbound scanner…");
        api.get("/api/fulfillment/outbound-audits/" + Uri.encode(auditId), new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                currentOutboundSession = response.optJSONObject("session");
                outboundScans = response.optJSONArray("scans");
                if (outboundScans == null) outboundScans = new JSONArray();
                activeOutboundPackage = firstIncompleteRequiredPackage();
                if (currentOutboundSession == null) {
                    showRetry("Outbound audit not found", "DataPlus did not return this handoff.", () -> showOutboundDashboard(true));
                    return;
                }
                showOutboundScanner();
                if (!pendingOutboundBarcode.isEmpty()) {
                    String barcode = pendingOutboundBarcode;
                    pendingOutboundBarcode = "";
                    recordOutboundPackage(barcode);
                }
            }
            @Override public void onError(ApiClient.ApiException error) {
                if (error.isUnauthorized()) showLogin();
                else showRetry("Unable to open outbound scanner", error.getMessage(), () -> openOutboundAudit(auditId));
            }
        });
    }

    private JSONObject firstIncompleteRequiredPackage() {
        for (int index = 0; index < outboundScans.length(); index++) {
            JSONObject scan = outboundScans.optJSONObject(index);
            if (scan != null && scan.optBoolean("liveItemRequired") && !"complete".equalsIgnoreCase(scan.optString("liveItemStatus"))) return scan;
        }
        return null;
    }

    private void showOutboundScanner() {
        if (currentOutboundSession == null) return;
        screen = SCREEN_OUTBOUND_SCANNER;
        modalOpen = false;
        busy = false;
        bottomNav.setVisibility(View.GONE);
        backButton.setVisibility(View.VISIBLE);
        accountButton.setVisibility(View.VISIBLE);
        toolbarTitle.setText(activeOutboundPackage == null ? "Scan outbound" : "Scan package items");

        ScrollView scroll = new ScrollView(this);
        LinearLayout page = Ui.column(this, 0);
        page.setFocusableInTouchMode(true);
        page.setPadding(Ui.dp(this, 13), Ui.dp(this, 14), Ui.dp(this, 13), Ui.dp(this, 30));

        LinearLayout auditCard = Ui.card(this);
        LinearLayout heading = Ui.row(this);
        heading.addView(Ui.text(this, outboundAuditReference(currentOutboundSession), 18, Ui.TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        heading.addView(Ui.chip(this, currentOutboundSession.optString("status", "open"), Ui.SUCCESS, Ui.SUCCESS_SOFT));
        auditCard.addView(heading);
        TextView warehouse = Ui.text(this, currentOutboundSession.optString("warehouseName", "Warehouse"), 14, Ui.TEXT, true);
        Ui.margin(warehouse, 0, 9, 0, 3);
        auditCard.addView(warehouse);
        auditCard.addView(Ui.text(this, "Operating mixed-carrier session · " + outboundSessionDate(currentOutboundSession), 13, Ui.MUTED, false));
        String summary = currentOutboundSession.optInt("packageCount") + " packages · " + currentOutboundSession.optInt("matchedCount") + " matched";
        if (currentOutboundSession.optInt("pendingMatchCount") > 0) summary += " · " + currentOutboundSession.optInt("pendingMatchCount") + " matching";
        if (currentOutboundSession.optInt("unmatchedCount") > 0) summary += " · " + currentOutboundSession.optInt("unmatchedCount") + " unmatched";
        TextView counts = Ui.text(this, summary, 13, currentOutboundSession.optInt("unmatchedCount") > 0 ? Ui.WARNING : Ui.MUTED, true);
        Ui.margin(counts, 0, 12, 0, 0);
        auditCard.addView(counts);
        TextView carrierBreakdown = Ui.text(this, outboundCarrierBreakdownLabel(currentOutboundSession), 12, Ui.MUTED, false);
        Ui.margin(carrierBreakdown, 0, 7, 0, 0);
        auditCard.addView(carrierBreakdown);
        page.addView(auditCard, Ui.matchWrap());

        if (activeOutboundPackage != null) addActiveOutboundPackage(page);

        LinearLayout scannerCard = Ui.card(this);
        scannerCard.setBackground(Ui.bordered(Ui.SURFACE, activeOutboundPackage == null ? 0xFFBFDBFE : 0xFFFCD34D, 18, this));
        LinearLayout scannerHeading = Ui.row(this);
        TextView scannerIcon = Ui.text(this, activeOutboundPackage == null ? "⇥" : "▣", 24, Color.WHITE, true);
        scannerIcon.setGravity(Gravity.CENTER);
        scannerIcon.setBackground(Ui.rounded(activeOutboundPackage == null ? Ui.PRIMARY : Ui.WARNING, 15, this));
        scannerHeading.addView(scannerIcon, new LinearLayout.LayoutParams(Ui.dp(this, 52), Ui.dp(this, 52)));
        LinearLayout scannerTitle = Ui.column(this, 0);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        titleParams.setMargins(Ui.dp(this, 12), 0, 0, 0);
        scannerHeading.addView(scannerTitle, titleParams);
        scannerTitle.addView(Ui.text(this, activeOutboundPackage == null ? "Tracking scanner ready" : "Item scanner ready", 17, Ui.TEXT, true));
        TextView instruction = Ui.text(this, activeOutboundPackage == null
            ? "Scan the shipping label. DataPlus saves it immediately and matches the order in the background."
            : "Scan each physical item UPC for this package before moving to the next label.", 13, Ui.MUTED, false);
        Ui.margin(instruction, 0, 3, 0, 0);
        scannerTitle.addView(instruction);
        scannerCard.addView(scannerHeading);

        scannerCapture = scannerCaptureField(activeOutboundPackage == null ? "Waiting for tracking barcode" : "Waiting for item UPC");
        LinearLayout.LayoutParams previewParams = Ui.matchWrap();
        previewParams.height = Ui.dp(this, 54);
        previewParams.setMargins(0, Ui.dp(this, 16), 0, 0);
        scannerCard.addView(scannerCapture, previewParams);

        scannerStatus = Ui.text(this, "Scanner input active · press either G47 trigger", 12, Ui.SUCCESS, true);
        Ui.margin(scannerStatus, 0, 8, 0, 0);
        scannerCard.addView(scannerStatus);

        LinearLayout fallbackRow = Ui.row(this);
        Button typeButton = Ui.button(this, activeOutboundPackage == null ? "Type tracking" : "Type item UPC", false);
        typeButton.setOnClickListener(view -> showOutboundManualBarcodeDialog());
        fallbackRow.addView(typeButton, new LinearLayout.LayoutParams(0, Ui.dp(this, 50), 1));
        Button webButton = Ui.button(this, pendingOutboundPhotoCount() > 0 ? "Photo uploads " + pendingOutboundPhotoCount() : "Photo uploads", false);
        webButton.setOnClickListener(view -> {
            retryPendingOutboundPhotos();
            Toast.makeText(this, pendingOutboundPhotoCount() > 0 ? "Pending photos are uploading in the background." : "No package photos are waiting to upload.", Toast.LENGTH_SHORT).show();
        });
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 50), 1);
        webParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        fallbackRow.addView(webButton, webParams);
        LinearLayout.LayoutParams fallbackParams = Ui.matchWrap();
        fallbackParams.setMargins(0, Ui.dp(this, 12), 0, 0);
        scannerCard.addView(fallbackRow, fallbackParams);
        LinearLayout.LayoutParams scannerParams = Ui.matchWrap();
        scannerParams.setMargins(0, Ui.dp(this, 12), 0, 0);
        page.addView(scannerCard, scannerParams);

        TextView recentTitle = Ui.text(this, "Scanned packages", 17, Ui.TEXT, true);
        Ui.margin(recentTitle, 2, 20, 0, 8);
        page.addView(recentTitle);
        LinearLayout packageList = Ui.column(this, 0);
        addOutboundPackageFilters(page, packageList);
        addRecentOutboundPackages(packageList);
        page.addView(packageList, Ui.matchWrap());

        LinearLayout actionCard = Ui.card(this);
        Button reconcile = Ui.button(this, "Recheck unmatched packages", false);
        reconcile.setEnabled(currentOutboundSession.optInt("unmatchedCount") > 0);
        reconcile.setOnClickListener(view -> reconcileOutboundAudit());
        actionCard.addView(reconcile, Ui.matchWrap());
        Button close = Ui.button(this, "Close handoff audit", false);
        close.setTextColor(Ui.ERROR);
        close.setOnClickListener(view -> showCloseOutboundDialog());
        Ui.margin(close, 0, 9, 0, 0);
        actionCard.addView(close, Ui.matchWrap());
        LinearLayout.LayoutParams actionParams = Ui.matchWrap();
        actionParams.setMargins(0, Ui.dp(this, 18), 0, 0);
        page.addView(actionCard, actionParams);

        scroll.addView(page);
        setScreen(scroll);
        page.requestFocus();
        focusScanner();
    }

    private void addActiveOutboundPackage(LinearLayout page) {
        LinearLayout card = Ui.card(this);
        card.setBackground(Ui.bordered(Ui.WARNING_SOFT, 0xFFFCD34D, 16, this));
        LinearLayout heading = Ui.row(this);
        heading.addView(Ui.text(this, "Finish this package", 16, Ui.TEXT, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        heading.addView(Ui.chip(this, outboundItemProgress(activeOutboundPackage), Ui.WARNING, 0xFFFFFBEB));
        card.addView(heading);
        TextView tracking = Ui.text(this, activeOutboundPackage.optString("trackingNumber", "Package"), 14, Ui.TEXT, true);
        tracking.setTypeface(Typeface.MONOSPACE);
        Ui.margin(tracking, 0, 9, 0, 3);
        card.addView(tracking);
        card.addView(Ui.text(this, outboundOrderLabel(activeOutboundPackage), 13, Ui.MUTED, false));
        if (!activeOutboundPackage.optBoolean("liveItemRequired")) {
            Button skip = Ui.button(this, "Skip optional item verification", false);
            skip.setOnClickListener(view -> {
                activeOutboundPackage = null;
                showOutboundScanner();
            });
            Ui.margin(skip, 0, 12, 0, 0);
            card.addView(skip, Ui.matchWrap());
        }
        LinearLayout.LayoutParams params = Ui.matchWrap();
        params.setMargins(0, Ui.dp(this, 12), 0, 0);
        page.addView(card, params);
    }

    private void addRecentOutboundPackages(LinearLayout page) {
        if (outboundScans.length() == 0) {
            LinearLayout empty = Ui.card(this);
            TextView text = Ui.text(this, "Scan the first tracking label to begin.", 14, Ui.MUTED, false);
            text.setGravity(Gravity.CENTER);
            empty.addView(text, Ui.matchWrap());
            page.addView(empty, Ui.matchWrap());
            return;
        }
        int shown = 0;
        for (int index = 0; index < outboundScans.length(); index++) {
            JSONObject scan = outboundScans.optJSONObject(index);
            if (scan == null) continue;
            boolean unmatched = "unmatched".equalsIgnoreCase(scan.optString("matchStatus"));
            boolean matching = "pending".equalsIgnoreCase(scan.optString("matchStatus"));
            if ("matched".equals(outboundPackageFilter) && (unmatched || matching)) continue;
            if ("unmatched".equals(outboundPackageFilter) && !unmatched) continue;
            LinearLayout card = Ui.card(this);
            card.setClickable(true);
            card.setFocusable(true);
            card.setOnClickListener(view -> showOutboundPackageDetails(scan));
            LinearLayout first = Ui.row(this);
            TextView tracking = Ui.text(this, scan.optString("trackingNumber", "Package"), 14, Ui.TEXT, true);
            tracking.setTypeface(Typeface.MONOSPACE);
            first.addView(tracking, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            first.addView(Ui.chip(this, matching ? "Matching" : unmatched ? "Unmatched" : "Matched", matching ? Ui.PRIMARY : unmatched ? Ui.WARNING : Ui.SUCCESS, matching ? 0xFFEFF6FF : unmatched ? Ui.WARNING_SOFT : Ui.SUCCESS_SOFT));
            card.addView(first);
            TextView order = Ui.text(this, outboundOrderLabel(scan), 13, Ui.MUTED, false);
            Ui.margin(order, 0, 7, 0, 0);
            card.addView(order);
            if (scan.optInt("liveItemExpectedCount") > 0 || scan.optInt("liveItemScannedCount") > 0) {
                TextView items = Ui.text(this, outboundItemVerificationLabel(scan), 12, "complete".equalsIgnoreCase(scan.optString("liveItemStatus")) ? Ui.SUCCESS : Ui.WARNING, true);
                Ui.margin(items, 0, 6, 0, 0);
                card.addView(items);
            }
            TextView hint = Ui.text(this, "Tap to view package details", 11, Ui.PRIMARY, true);
            Ui.margin(hint, 0, 8, 0, 0);
            card.addView(hint);
            LinearLayout.LayoutParams params = Ui.matchWrap();
            params.setMargins(0, shown == 0 ? 0 : Ui.dp(this, 8), 0, 0);
            page.addView(card, params);
            shown++;
        }
        if (shown == 0) {
            LinearLayout empty = Ui.card(this);
            TextView text = Ui.text(this, "No " + outboundPackageFilter + " packages in this handoff.", 13, Ui.MUTED, false);
            text.setGravity(Gravity.CENTER);
            empty.addView(text, Ui.matchWrap());
            page.addView(empty, Ui.matchWrap());
        }
    }

    private void addOutboundPackageFilters(LinearLayout page, LinearLayout packageList) {
        LinearLayout filters = Ui.row(this);
        Button all = Ui.button(this, "All " + currentOutboundSession.optInt("packageCount"), false);
        Button matched = Ui.button(this, "Matched " + currentOutboundSession.optInt("matchedCount"), false);
        Button unmatched = Ui.button(this, "Unmatched " + currentOutboundSession.optInt("unmatchedCount"), false);
        Button[] buttons = new Button[]{all, matched, unmatched};
        String[] values = new String[]{"all", "matched", "unmatched"};
        for (int index = 0; index < buttons.length; index++) {
            final int selected = index;
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, Ui.dp(this, 44), 1);
            if (index > 0) params.setMargins(Ui.dp(this, 6), 0, 0, 0);
            filters.addView(buttons[index], params);
            buttons[index].setOnClickListener(view -> {
                outboundPackageFilter = values[selected];
                styleOutboundFilterButtons(buttons, values);
                packageList.removeAllViews();
                addRecentOutboundPackages(packageList);
            });
        }
        styleOutboundFilterButtons(buttons, values);
        LinearLayout.LayoutParams filterParams = Ui.matchWrap();
        filterParams.setMargins(0, 0, 0, Ui.dp(this, 8));
        page.addView(filters, filterParams);
    }

    private void styleOutboundFilterButtons(Button[] buttons, String[] values) {
        for (int index = 0; index < buttons.length; index++) {
            boolean selected = values[index].equals(outboundPackageFilter);
            buttons[index].setTextColor(selected ? Color.WHITE : Ui.TEXT);
            buttons[index].setBackground(Ui.rounded(selected ? Ui.PRIMARY : 0xFFF8FAFC, 12, this));
        }
    }

    private void showOutboundPackageDetails(JSONObject scan) {
        boolean unmatched = "unmatched".equalsIgnoreCase(scan.optString("matchStatus"));
        boolean matching = "pending".equalsIgnoreCase(scan.optString("matchStatus"));
        boolean canScanItems = scan.optInt("liveItemExpectedCount") > 0 && !"complete".equalsIgnoreCase(scan.optString("liveItemStatus"));
        StringBuilder detail = new StringBuilder();
        detail.append(matching ? "Order matching in background" : unmatched ? "No order match" : outboundOrderLabel(scan));
        if (scan.optInt("liveItemExpectedCount") > 0 || scan.optInt("liveItemScannedCount") > 0) {
            detail.append("\n\n").append(outboundItemVerificationLabel(scan));
        }
        if (!scan.optString("carrier").isEmpty()) detail.append("\nCarrier: ").append(scan.optString("carrier"));
        if (!scan.optString("scannedByName").isEmpty()) detail.append("\nScanned by: ").append(scan.optString("scannedByName"));
        detail.append("\nPhotos: ").append(scan.optInt("evidenceCount") > 0 ? scan.optInt("evidenceCount") + " saved" : "optional · missing");
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle(scan.optString("trackingNumber", "Package"))
            .setMessage(detail.toString())
            .setPositiveButton("Close", null)
            .setNeutralButton(scan.optInt("evidenceCount") > 0 ? "Another photo" : "Optional photo", (value, which) -> takeOutboundPhoto(scan));
        if (canScanItems) {
            builder.setNegativeButton("Scan package items", (value, which) -> {
                activeOutboundPackage = scan;
                showOutboundScanner();
            });
        }
        modalOpen = true;
        AlertDialog dialog = builder.create();
        dialog.setOnDismissListener(value -> {
            modalOpen = false;
            focusScanner();
        });
        dialog.show();
    }

    private void handleHardwareScan(String barcode) {
        if (SCREEN_OUTBOUND.equals(screen)) {
            routeOutboundDashboardScan(barcode);
        } else if (SCREEN_OUTBOUND_SCANNER.equals(screen)) {
            if (activeOutboundPackage == null) recordOutboundPackage(barcode);
            else recordOutboundItem(barcode);
        } else {
            lookupBarcode(barcode);
        }
    }

    private void recordOutboundPackage(String rawTracking) {
        recordOutboundPackage(rawTracking, false);
    }

    private void recordOutboundPackage(String rawTracking, boolean allowUnrecognizedTracking) {
        String tracking = normalizedScannerValue(rawTracking);
        if (tracking.isEmpty() || currentOutboundSession == null || busy) return;
        if (!allowUnrecognizedTracking && !isLikelyOutboundTracking(tracking)) {
            rejectNonTrackingBarcode(tracking);
            return;
        }
        if (!isOnline()) {
            scannerMessage("Offline — reconnect before scanning.", false);
            feedback(false);
            return;
        }
        JSONObject existing = findOutboundPackage(tracking);
        if (existing != null) {
            scannerMessage("Already scanned: " + tracking, false);
            feedback(false);
            showOutboundPackageResult(existing, true, "This package was already scanned in this handoff.");
            return;
        }
        busy = true;
        scannerMessage("Saving " + tracking + "…", true);
        JSONObject body = new JSONObject();
        try {
            body.put("trackingNumber", tracking)
                .put("clientScanId", UUID.randomUUID().toString())
                .put("deferOrderMatch", true);
        } catch (Exception ignored) {}
        String path = "/api/fulfillment/outbound-audits/" + Uri.encode(currentOutboundSession.optString("id")) + "/scan";
        api.post(path, body, new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                busy = false;
                JSONObject session = response.optJSONObject("session");
                JSONObject scan = response.optJSONObject("scan");
                String previousSessionId = currentOutboundSession == null ? "" : currentOutboundSession.optString("id");
                boolean operatingRollover = session != null && !previousSessionId.isEmpty() && !previousSessionId.equals(session.optString("id"));
                if (operatingRollover) {
                    outboundScans = new JSONArray();
                    activeOutboundPackage = null;
                }
                if (session != null) currentOutboundSession = session;
                if (scan == null) {
                    scannerMessage("Package details were not returned.", false);
                    feedback(false);
                    return;
                }
                updateOutboundScan(scan);
                boolean required = scan.optBoolean("liveItemRequired") && !"complete".equalsIgnoreCase(scan.optString("liveItemStatus"));
                activeOutboundPackage = required ? scan : null;
                boolean duplicate = response.optBoolean("duplicate");
                feedback(!duplicate);
                showOutboundPackageResult(scan, duplicate, response.optString("message", duplicate ? "This package was already scanned in this handoff." : "Package recorded."));
            }
            @Override public void onError(ApiClient.ApiException error) {
                busy = false;
                if (error.isUnauthorized()) showLogin();
                else {
                    scannerMessage(error.getMessage(), false);
                    feedback(false);
                    focusScanner();
                }
            }
        });
    }

    private JSONObject findOutboundPackage(String tracking) {
        String target = tracking.replaceAll("[^0-9A-Za-z]", "").toUpperCase(Locale.US);
        for (int index = 0; index < outboundScans.length(); index++) {
            JSONObject scan = outboundScans.optJSONObject(index);
            if (scan == null) continue;
            String saved = scan.optString("trackingNumber").replaceAll("[^0-9A-Za-z]", "").toUpperCase(Locale.US);
            if (!target.isEmpty() && target.equals(saved)) return scan;
        }
        return null;
    }

    private void showOutboundPackageResult(JSONObject scan, boolean duplicate, String message) {
        modalOpen = true;
        Dialog dialog = bottomDialog();
        LinearLayout sheet = Ui.column(this, 0);
        sheet.setPadding(Ui.dp(this, 20), Ui.dp(this, 12), Ui.dp(this, 20), Ui.dp(this, 24));
        sheet.setBackground(Ui.rounded(Ui.SURFACE, 24, this));
        View handle = new View(this);
        handle.setBackground(Ui.rounded(0xFFD1D5DB, 99, this));
        LinearLayout.LayoutParams handleParams = new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 5));
        handleParams.gravity = Gravity.CENTER_HORIZONTAL;
        sheet.addView(handle, handleParams);
        TextView title = Ui.text(this, duplicate ? "Package already recorded" : "Package recorded", 20, Ui.TEXT, true);
        Ui.margin(title, 0, 17, 0, 5);
        sheet.addView(title);
        sheet.addView(Ui.text(this, message, 14, Ui.MUTED, false));

        LinearLayout packageCard = Ui.card(this);
        boolean unmatched = "unmatched".equalsIgnoreCase(scan.optString("matchStatus"));
        boolean matching = "pending".equalsIgnoreCase(scan.optString("matchStatus"));
        packageCard.setBackground(Ui.bordered(matching ? 0xFFEFF6FF : unmatched ? Ui.WARNING_SOFT : Ui.SUCCESS_SOFT, matching ? 0xFF93C5FD : unmatched ? 0xFFFCD34D : 0xFFA7F3D0, 16, this));
        LinearLayout packageHeading = Ui.row(this);
        TextView tracking = Ui.text(this, scan.optString("trackingNumber", "Package"), 16, Ui.TEXT, true);
        tracking.setTypeface(Typeface.MONOSPACE);
        packageHeading.addView(tracking, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        packageHeading.addView(Ui.chip(this, matching ? "Matching in background" : unmatched ? "No order match" : "Order matched", matching ? Ui.PRIMARY : unmatched ? Ui.WARNING : Ui.SUCCESS, Ui.SURFACE));
        packageCard.addView(packageHeading);
        TextView order = Ui.text(this, outboundOrderLabel(scan), 13, Ui.MUTED, false);
        Ui.margin(order, 0, 9, 0, 0);
        packageCard.addView(order);
        if (scan.optInt("liveItemExpectedCount") > 0) {
            TextView items = Ui.text(this, (scan.optBoolean("liveItemRequired") ? "Required item scans " : "Optional item scans ") + outboundItemProgress(scan), 13, Ui.WARNING, true);
            Ui.margin(items, 0, 8, 0, 0);
            packageCard.addView(items);
        }
        LinearLayout.LayoutParams packageParams = Ui.matchWrap();
        packageParams.setMargins(0, Ui.dp(this, 16), 0, 0);
        sheet.addView(packageCard, packageParams);

        Button photo = Ui.button(this, scan.optInt("evidenceCount") > 0 ? "Take another optional photo" : "Take optional photo · missing", false);
        photo.setOnClickListener(view -> {
            dialog.dismiss();
            takeOutboundPhoto(scan);
        });
        Ui.margin(photo, 0, 12, 0, 0);
        sheet.addView(photo, Ui.matchWrap());

        LinearLayout actions = Ui.row(this);
        boolean canScanItems = scan.optInt("liveItemExpectedCount") > 0 && !"complete".equalsIgnoreCase(scan.optString("liveItemStatus"));
        Button next = Ui.button(this, canScanItems && scan.optBoolean("liveItemRequired") ? "Full tools" : "Next package", false);
        actions.addView(next, new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1));
        Button primary = Ui.button(this, canScanItems ? "Scan package items" : "Done", true);
        LinearLayout.LayoutParams primaryParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1);
        primaryParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        actions.addView(primary, primaryParams);
        Ui.margin(actions, 0, 18, 0, 0);
        sheet.addView(actions);
        next.setOnClickListener(view -> {
            if (canScanItems && scan.optBoolean("liveItemRequired")) {
                dialog.dismiss();
                openWeb("/warehouse/outbound");
            } else {
                activeOutboundPackage = null;
                dialog.dismiss();
            }
        });
        primary.setOnClickListener(view -> {
            activeOutboundPackage = canScanItems ? scan : null;
            dialog.dismiss();
        });
        dialog.setContentView(sheet);
        dialog.setOnDismissListener(value -> {
            modalOpen = false;
            showOutboundScanner();
        });
        dialog.show();
        sizeBottomDialog(dialog);
    }

    private void takeOutboundPhoto(JSONObject scan) {
        if (scan == null || currentOutboundSession == null || busy) return;
        pendingPhotoAuditId = currentOutboundSession.optString("id");
        pendingPhotoScanId = scan.optString("id");
        pendingPhotoTracking = scan.optString("trackingNumber", "package");
        if (pendingPhotoAuditId.isEmpty() || pendingPhotoScanId.isEmpty()) {
            scannerMessage("This package is not available for a photo.", false);
            feedback(false);
            clearPendingPhoto();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, OUTBOUND_CAMERA_PERMISSION_REQUEST);
            return;
        }
        launchNativePhotoCapture();
    }

    private void launchNativePhotoCapture() {
        Intent intent = new Intent(this, PhotoCaptureActivity.class);
        startActivityForResult(intent, OUTBOUND_PHOTO_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != OUTBOUND_PHOTO_REQUEST) return;
        if (resultCode != RESULT_OK || data == null) {
            String error = data == null ? "" : data.getStringExtra(PhotoCaptureActivity.EXTRA_ERROR);
            if (error == null || error.trim().isEmpty()) scannerMessage("Photo canceled. The package remains recorded.", true);
            else {
                scannerMessage(error, false);
                feedback(false);
            }
            clearPendingPhoto();
            focusScanner();
            return;
        }
        String path = data.getStringExtra(PhotoCaptureActivity.EXTRA_PHOTO_PATH);
        File photo = path == null ? null : new File(path);
        if (photo == null || !photo.isFile() || photo.length() <= 0) {
            scannerMessage("The camera did not return a usable package photo.", false);
            feedback(false);
            clearPendingPhoto();
            focusScanner();
            return;
        }
        String auditId = pendingPhotoAuditId;
        String scanId = pendingPhotoScanId;
        String tracking = pendingPhotoTracking;
        busy = true;
        scannerMessage("Preparing package photo…", true);
        new Thread(() -> {
            try {
                PhotoPayload payload = prepareOutboundPhoto(photo);
                JSONObject queued = persistOutboundPhoto(photo, payload, auditId, scanId, tracking);
                runOnUiThread(() -> {
                    busy = false;
                    clearPendingPhoto();
                    activeOutboundPackage = null;
                    showOutboundScanner();
                    scannerMessage("Photo queued for " + tracking + ". Keep scanning while it uploads.", true);
                    Toast.makeText(LauncherActivity.this, "Photo queued. Upload continues in the background.", Toast.LENGTH_SHORT).show();
                    uploadQueuedOutboundPhoto(queued);
                    focusScanner();
                });
            } catch (Exception error) {
                runOnUiThread(() -> finishPhotoQueueError(photo, error.getMessage()));
            }
        }, "DataPlusPhotoPrepare").start();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != OUTBOUND_CAMERA_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) launchNativePhotoCapture();
        else {
            scannerMessage("Camera permission is required to take an optional package photo.", false);
            feedback(false);
            clearPendingPhoto();
        }
    }

    private synchronized JSONObject persistOutboundPhoto(File sourcePhoto, PhotoPayload payload, String auditId, String scanId, String tracking) throws Exception {
        String evidenceId = UUID.randomUUID().toString();
        File directory = new File(getFilesDir(), "outbound-photo-queue");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("The app could not create its background photo queue.");
        File queuedFile = new File(directory, evidenceId + ".jpg");
        try (FileOutputStream output = new FileOutputStream(queuedFile)) {
            output.write(payload.bytes);
        }
        if (sourcePhoto != null && sourcePhoto.exists()) sourcePhoto.delete();
        JSONObject queued = new JSONObject();
        queued.put("id", evidenceId);
        queued.put("auditId", auditId);
        queued.put("scanId", scanId);
        queued.put("tracking", tracking);
        queued.put("path", queuedFile.getAbsolutePath());
        queued.put("byteSize", payload.bytes.length);
        queued.put("width", payload.width);
        queued.put("height", payload.height);
        queued.put("capturedAt", utcTimestamp());
        JSONArray pending = pendingOutboundPhotos();
        pending.put(queued);
        preferences.edit().putString(PENDING_OUTBOUND_PHOTOS, pending.toString()).apply();
        return queued;
    }

    private synchronized JSONArray pendingOutboundPhotos() {
        try { return new JSONArray(preferences.getString(PENDING_OUTBOUND_PHOTOS, "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    private int pendingOutboundPhotoCount() {
        return pendingOutboundPhotos().length();
    }

    private synchronized void removePendingOutboundPhoto(String evidenceId) {
        JSONArray current = pendingOutboundPhotos();
        JSONArray next = new JSONArray();
        for (int index = 0; index < current.length(); index++) {
            JSONObject item = current.optJSONObject(index);
            if (item != null && !evidenceId.equals(item.optString("id"))) next.put(item);
        }
        preferences.edit().putString(PENDING_OUTBOUND_PHOTOS, next.toString()).apply();
    }

    private void retryPendingOutboundPhotos() {
        if (preferences == null || !isOnline()) return;
        JSONArray pending = pendingOutboundPhotos();
        for (int index = 0; index < pending.length(); index++) {
            JSONObject item = pending.optJSONObject(index);
            if (item != null) uploadQueuedOutboundPhoto(item);
        }
    }

    private void uploadQueuedOutboundPhoto(JSONObject queued) {
        if (queued == null || !isOnline()) return;
        String evidenceId = queued.optString("id");
        String auditId = queued.optString("auditId");
        String scanId = queued.optString("scanId");
        File photo = new File(queued.optString("path"));
        if (evidenceId.isEmpty() || auditId.isEmpty() || scanId.isEmpty() || !photo.isFile()) {
            removePendingOutboundPhoto(evidenceId);
            return;
        }
        if (activePhotoUploads.contains(evidenceId)) return;
        activePhotoUploads.add(evidenceId);
        JSONObject body = new JSONObject();
        try {
            body.put("clientEvidenceId", evidenceId);
            body.put("contentType", "image/jpeg");
            body.put("byteSize", queued.optInt("byteSize", (int) photo.length()));
            body.put("width", queued.optInt("width"));
            body.put("height", queued.optInt("height"));
            body.put("capturedAt", queued.optString("capturedAt", utcTimestamp()));
        } catch (Exception ignored) {}
        String path = "/api/fulfillment/outbound-audits/" + Uri.encode(auditId)
            + "/scans/" + Uri.encode(scanId) + "/evidence";
        photoApi.post(path, body, new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                String uploadUrl = response.optString("uploadUrl");
                if (uploadUrl.isEmpty()) {
                    finishBackgroundPhotoUpload(evidenceId, false, "DataPlus did not return a package photo upload address.", scanId, queued.optString("tracking"), photo);
                    return;
                }
                byte[] bytes;
                try {
                    bytes = readQueuedPhoto(photo);
                } catch (Exception error) {
                    finishBackgroundPhotoUpload(evidenceId, false, error.getMessage(), scanId, queued.optString("tracking"), photo);
                    return;
                }
                photoApi.putBytes(uploadUrl, bytes, "image/jpeg", new ApiClient.Callback() {
                    @Override public void onSuccess(JSONObject uploadResponse) {
                        finishBackgroundPhotoUpload(evidenceId, true, uploadResponse.optString("message", "Package photo saved."), scanId, queued.optString("tracking"), photo);
                    }
                    @Override public void onError(ApiClient.ApiException error) {
                        finishBackgroundPhotoUpload(evidenceId, false, error.getMessage(), scanId, queued.optString("tracking"), photo);
                    }
                });
            }
            @Override public void onError(ApiClient.ApiException error) {
                finishBackgroundPhotoUpload(evidenceId, false, error.getMessage(), scanId, queued.optString("tracking"), photo);
            }
        });
    }

    private void finishBackgroundPhotoUpload(String evidenceId, boolean success, String message, String scanId, String tracking, File photo) {
        activePhotoUploads.remove(evidenceId);
        if (!success) {
            if (SCREEN_OUTBOUND_SCANNER.equals(screen)) scannerMessage("Photo pending upload. Package scans can continue.", true);
            return;
        }
        removePendingOutboundPhoto(evidenceId);
        if (photo != null && photo.exists()) photo.delete();
        incrementOutboundEvidenceCount(scanId);
        if (SCREEN_OUTBOUND_SCANNER.equals(screen)) scannerMessage("Photo saved for " + tracking + ".", true);
    }

    private void finishPhotoQueueError(File photo, String message) {
        busy = false;
        if (photo != null && photo.exists()) photo.delete();
        clearPendingPhoto();
        scannerMessage(message == null || message.trim().isEmpty() ? "Unable to save the package photo." : message, false);
        feedback(false);
        Toast.makeText(this, message == null ? "Unable to save the package photo." : message, Toast.LENGTH_LONG).show();
        focusScanner();
    }

    private static byte[] readQueuedPhoto(File file) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream((int) Math.min(file.length(), OUTBOUND_PHOTO_MAX_BYTES));
        byte[] buffer = new byte[16_384];
        try (FileInputStream input = new FileInputStream(file)) {
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private void incrementOutboundEvidenceCount(String scanId) {
        for (int index = 0; index < outboundScans.length(); index++) {
            JSONObject scan = outboundScans.optJSONObject(index);
            if (scan == null || !scanId.equals(scan.optString("id"))) continue;
            try {
                scan.put("evidenceCount", scan.optInt("evidenceCount") + 1);
                scan.put("evidenceStatus", "complete");
            } catch (Exception ignored) {}
            if (activeOutboundPackage != null && scanId.equals(activeOutboundPackage.optString("id"))) activeOutboundPackage = scan;
            return;
        }
    }

    private void clearPendingPhoto() {
        pendingPhotoAuditId = "";
        pendingPhotoScanId = "";
        pendingPhotoTracking = "";
    }

    private static PhotoPayload prepareOutboundPhoto(File file) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeFile(file.getAbsolutePath());
        if (bitmap == null) throw new IllegalStateException("The package photo could not be decoded.");
        Bitmap working = orientPhoto(bitmap, file);
        int longest = Math.max(working.getWidth(), working.getHeight());
        if (longest > 1920) {
            float scale = 1920f / longest;
            Bitmap scaled = Bitmap.createScaledBitmap(working, Math.round(working.getWidth() * scale), Math.round(working.getHeight() * scale), true);
            if (scaled != working) working.recycle();
            working = scaled;
        }
        int quality = 86;
        byte[] bytes = compressJpeg(working, quality);
        while (bytes.length > OUTBOUND_PHOTO_MAX_BYTES && quality > 46) {
            quality -= 10;
            bytes = compressJpeg(working, quality);
        }
        while (bytes.length > OUTBOUND_PHOTO_MAX_BYTES && Math.max(working.getWidth(), working.getHeight()) > 900) {
            Bitmap scaled = Bitmap.createScaledBitmap(working, Math.round(working.getWidth() * 0.8f), Math.round(working.getHeight() * 0.8f), true);
            if (scaled != working) working.recycle();
            working = scaled;
            bytes = compressJpeg(working, 70);
        }
        if (bytes.length > OUTBOUND_PHOTO_MAX_BYTES) {
            working.recycle();
            throw new IllegalStateException("The package photo is too large. Move closer and take it again.");
        }
        PhotoPayload result = new PhotoPayload(bytes, working.getWidth(), working.getHeight());
        working.recycle();
        return result;
    }

    private static Bitmap orientPhoto(Bitmap bitmap, File file) {
        try {
            ExifInterface exif = new ExifInterface(file.getAbsolutePath());
            int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            Matrix matrix = new Matrix();
            if (orientation == ExifInterface.ORIENTATION_ROTATE_90) matrix.postRotate(90);
            else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) matrix.postRotate(180);
            else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) matrix.postRotate(270);
            else if (orientation == ExifInterface.ORIENTATION_FLIP_HORIZONTAL) matrix.preScale(-1, 1);
            else if (orientation == ExifInterface.ORIENTATION_FLIP_VERTICAL) matrix.preScale(1, -1);
            else return bitmap;
            Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
            if (oriented != bitmap) bitmap.recycle();
            return oriented;
        } catch (Exception ignored) {
            return bitmap;
        }
    }

    private static byte[] compressJpeg(Bitmap bitmap, int quality) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output);
        return output.toByteArray();
    }

    private static String utcTimestamp() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private static final class PhotoPayload {
        final byte[] bytes;
        final int width;
        final int height;

        PhotoPayload(byte[] bytes, int width, int height) {
            this.bytes = bytes;
            this.width = width;
            this.height = height;
        }
    }

    private void recordOutboundItem(String rawBarcode) {
        String barcode = normalizedScannerValue(rawBarcode);
        if (barcode.isEmpty() || activeOutboundPackage == null || currentOutboundSession == null || busy) return;
        if (!isOnline()) {
            scannerMessage("Offline — reconnect before scanning.", false);
            feedback(false);
            return;
        }
        busy = true;
        scannerMessage("Checking item " + barcode + "…", true);
        JSONObject body = new JSONObject();
        try {
            body.put("scanId", activeOutboundPackage.optString("id"));
            body.put("barcode", barcode);
            body.put("clientScanId", UUID.randomUUID().toString());
        } catch (Exception ignored) {}
        String path = "/api/fulfillment/outbound-audits/" + Uri.encode(currentOutboundSession.optString("id")) + "/item-scan";
        api.post(path, body, new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                busy = false;
                if (response.optBoolean("trackingCandidate")) {
                    feedback(false);
                    showOutboundItemWarning("Tracking label detected", response.optString("message", "This looks like another package label. Finish the current package items first."));
                    return;
                }
                if (response.optBoolean("notFound")) {
                    feedback(false);
                    showOutboundItemWarning("Item not found", response.optString("message", "This item could not be matched. Use full tools to review or create it."));
                    return;
                }
                JSONObject scan = response.optJSONObject("scan");
                if (scan == null) {
                    scannerMessage("Item details were not returned.", false);
                    feedback(false);
                    return;
                }
                updateOutboundScan(scan);
                activeOutboundPackage = "complete".equalsIgnoreCase(scan.optString("liveItemStatus")) ? null : scan;
                feedback(!response.optBoolean("duplicate"));
                Toast.makeText(LauncherActivity.this, response.optString("message", response.optBoolean("duplicate") ? "Item already scanned." : "Item recorded."), Toast.LENGTH_SHORT).show();
                showOutboundScanner();
            }
            @Override public void onError(ApiClient.ApiException error) {
                busy = false;
                if (error.isUnauthorized()) showLogin();
                else {
                    scannerMessage(error.getMessage(), false);
                    feedback(false);
                    focusScanner();
                }
            }
        });
    }

    private void showOutboundItemWarning(String title, String message) {
        modalOpen = true;
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("Continue scanning items", null)
            .setNeutralButton("Open full tools", (value, which) -> openWeb("/warehouse/outbound"))
            .create();
        dialog.setOnDismissListener(value -> { modalOpen = false; focusScanner(); });
        dialog.show();
    }

    private void showOutboundManualBarcodeDialog() {
        modalOpen = true;
        EditText value = input(activeOutboundPackage == null ? "Tracking number" : "Item SKU or UPC", false);
        value.setInputType(InputType.TYPE_CLASS_TEXT);
        LinearLayout wrapper = Ui.column(this, 0);
        wrapper.setPadding(Ui.dp(this, 20), Ui.dp(this, 4), Ui.dp(this, 20), 0);
        wrapper.addView(value, Ui.matchWrap());
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(activeOutboundPackage == null ? "Type tracking label" : "Type package item")
            .setView(wrapper)
            .setPositiveButton("Continue", (selected, which) -> {
                String barcode = value.getText().toString().trim();
                modalOpen = false;
                if (barcode.isEmpty()) return;
                if (activeOutboundPackage != null) recordOutboundItem(barcode);
                else if (SCREEN_OUTBOUND.equals(screen)) routeOutboundDashboardScan(barcode, true);
                else recordOutboundPackage(barcode, true);
            })
            .setNegativeButton("Cancel", null)
            .create();
        dialog.setOnDismissListener(selected -> { modalOpen = false; focusScanner(); });
        dialog.setOnShowListener(selected -> {
            value.requestFocus();
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        });
        dialog.show();
    }

    private void reconcileOutboundAudit() {
        if (currentOutboundSession == null || busy || !isOnline()) return;
        busy = true;
        scannerMessage("Rechecking unmatched packages…", true);
        String path = "/api/fulfillment/outbound-audits/" + Uri.encode(currentOutboundSession.optString("id")) + "/reconcile";
        api.post(path, new JSONObject(), new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                busy = false;
                JSONObject session = response.optJSONObject("session");
                JSONArray scans = response.optJSONArray("scans");
                if (session != null) currentOutboundSession = session;
                if (scans != null) outboundScans = scans;
                activeOutboundPackage = firstIncompleteRequiredPackage();
                feedback(true);
                Toast.makeText(LauncherActivity.this, response.optString("message", "Unmatched packages checked."), Toast.LENGTH_SHORT).show();
                showOutboundScanner();
            }
            @Override public void onError(ApiClient.ApiException error) {
                busy = false;
                if (error.isUnauthorized()) showLogin();
                else {
                    scannerMessage(error.getMessage(), false);
                    feedback(false);
                }
            }
        });
    }

    private void showCloseOutboundDialog() {
        if (currentOutboundSession == null) return;
        modalOpen = true;
        Dialog dialog = bottomDialog();
        LinearLayout sheet = Ui.column(this, 0);
        sheet.setPadding(Ui.dp(this, 20), Ui.dp(this, 12), Ui.dp(this, 20), Ui.dp(this, 24));
        sheet.setBackground(Ui.rounded(Ui.SURFACE, 24, this));
        TextView title = Ui.text(this, "Close outbound handoff", 20, Ui.TEXT, true);
        Ui.margin(title, 0, 8, 0, 5);
        sheet.addView(title);
        sheet.addView(Ui.text(this, "Confirm who received the packages. Required Live item scans must be complete.", 13, Ui.MUTED, false));
        TextView driverLabel = Ui.text(this, "Driver / receiving party", 13, Ui.TEXT, true);
        Ui.margin(driverLabel, 0, 18, 0, 6);
        sheet.addView(driverLabel);
        EditText driver = input("Name", false);
        sheet.addView(driver, Ui.matchWrap());
        TextView confirmationLabel = Ui.text(this, "Pickup confirmation", 13, Ui.TEXT, true);
        Ui.margin(confirmationLabel, 0, 14, 0, 6);
        sheet.addView(confirmationLabel);
        EditText confirmation = input("Reference or confirmation", false);
        sheet.addView(confirmation, Ui.matchWrap());
        TextView error = Ui.text(this, "", 13, Ui.ERROR, true);
        error.setVisibility(View.GONE);
        Ui.margin(error, 0, 12, 0, 0);
        sheet.addView(error);
        LinearLayout actions = Ui.row(this);
        Button cancel = Ui.button(this, "Cancel", false);
        actions.addView(cancel, new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1));
        Button close = Ui.button(this, "Close audit", true);
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1);
        closeParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        actions.addView(close, closeParams);
        Ui.margin(actions, 0, 18, 0, 0);
        sheet.addView(actions);
        cancel.setOnClickListener(view -> dialog.dismiss());
        close.setOnClickListener(view -> closeOutboundAudit(dialog, error, cancel, close, driver.getText().toString().trim(), confirmation.getText().toString().trim()));
        dialog.setContentView(sheet);
        dialog.setOnDismissListener(value -> { modalOpen = false; focusScanner(); });
        dialog.show();
        sizeBottomDialog(dialog);
    }

    private void closeOutboundAudit(Dialog dialog, TextView error, Button cancel, Button close, String driver, String confirmation) {
        if (currentOutboundSession == null || busy) return;
        if (!isOnline()) {
            error.setText("Reconnect before closing the audit.");
            error.setVisibility(View.VISIBLE);
            return;
        }
        busy = true;
        cancel.setEnabled(false);
        close.setEnabled(false);
        close.setText("Closing…");
        JSONObject body = new JSONObject();
        try {
            body.put("handoffMethod", "pickup");
            body.put("driverName", driver);
            body.put("pickupConfirmation", confirmation);
        } catch (Exception ignored) {}
        String path = "/api/fulfillment/outbound-audits/" + Uri.encode(currentOutboundSession.optString("id")) + "/close";
        api.post(path, body, new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) {
                busy = false;
                feedback(true);
                Toast.makeText(LauncherActivity.this, response.optString("message", "Outbound handoff closed."), Toast.LENGTH_SHORT).show();
                dialog.dismiss();
                showOutboundDashboard(true);
            }
            @Override public void onError(ApiClient.ApiException exception) {
                busy = false;
                if (exception.isUnauthorized()) {
                    dialog.dismiss();
                    showLogin();
                    return;
                }
                feedback(false);
                error.setText(exception.getMessage());
                error.setVisibility(View.VISIBLE);
                cancel.setEnabled(true);
                close.setEnabled(true);
                close.setText("Close audit");
            }
        });
    }

    private void updateOutboundScan(JSONObject updated) {
        JSONArray next = new JSONArray();
        next.put(updated);
        String id = updated.optString("id");
        for (int index = 0; index < outboundScans.length(); index++) {
            JSONObject scan = outboundScans.optJSONObject(index);
            if (scan != null && !id.equals(scan.optString("id"))) next.put(scan);
        }
        outboundScans = next;
    }

    private boolean isPhysicalWarehouse(JSONObject warehouse) {
        if (!warehouse.optBoolean("active", true)) return false;
        String type = warehouse.optString("type", warehouse.optString("warehouseType")).toLowerCase(Locale.US);
        return !type.contains("virtual") && !type.contains("supplier_feed") && !type.contains("supplier feed");
    }

    private String warehouseName(JSONObject warehouse) {
        String name = warehouse.optString("name");
        if (name.isEmpty()) name = warehouse.optString("code");
        return name.isEmpty() ? warehouse.optString("id", "Warehouse") : name;
    }

    private String outboundAuditReference(JSONObject audit) {
        String number = audit == null ? "" : audit.optString("auditNumber");
        return number.isEmpty() ? "Outbound audit" : number;
    }

    private String outboundSessionDate(JSONObject audit) {
        String operatingDate = audit == null ? "" : audit.optString("operatingDate");
        if (!operatingDate.isEmpty()) return operatingDate;
        String raw = audit == null ? "" : audit.optString("startedAt");
        if (raw.isEmpty()) return "Unknown date";
        try {
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US);
            Date value = parser.parse(raw);
            SimpleDateFormat formatter = new SimpleDateFormat("EEE, MMM d, yyyy", Locale.US);
            formatter.setTimeZone(TimeZone.getTimeZone("America/New_York"));
            return value == null ? raw : formatter.format(value);
        } catch (Exception ignored) {
            return raw.length() >= 10 ? raw.substring(0, 10) : raw;
        }
    }

    private String outboundCarrierBreakdownLabel(JSONObject audit) {
        JSONArray rows = audit == null ? null : audit.optJSONArray("carrierBreakdown");
        if (rows == null || rows.length() == 0) return "Carrier breakdown · no packages scanned yet";
        StringBuilder label = new StringBuilder("Carrier breakdown");
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null || row.optInt("count") <= 0) continue;
            label.append(" · ").append(row.optString("carrier", "Other")).append(" ").append(row.optInt("count"));
        }
        return label.toString();
    }

    private String outboundItemProgress(JSONObject scan) {
        int scanned = scan == null ? 0 : scan.optInt("liveItemScannedCount");
        int expected = scan == null ? 0 : scan.optInt("liveItemExpectedCount");
        return expected > 0 ? scanned + "/" + expected : scanned + " scanned";
    }

    private String outboundItemVerificationLabel(JSONObject scan) {
        int scanned = scan == null ? 0 : scan.optInt("liveItemScannedCount");
        int expected = scan == null ? 0 : scan.optInt("liveItemExpectedCount");
        String requirement = scan != null && scan.optBoolean("liveItemRequired") ? "Required" : "Optional";
        return requirement + " item verification: " + scanned + " of " + expected + " scanned";
    }

    private String outboundOrderLabel(JSONObject scan) {
        if (scan != null && "pending".equalsIgnoreCase(scan.optString("matchStatus"))) return "Order matching in background";
        JSONArray matches = scan == null ? null : scan.optJSONArray("matches");
        if (matches == null || matches.length() == 0) return "Tracking retained without an order match";
        List<String> numbers = new ArrayList<>();
        for (int index = 0; index < matches.length(); index++) {
            JSONObject match = matches.optJSONObject(index);
            if (match == null) continue;
            String number = match.optString("orderNumber", match.optString("orderId"));
            if (!number.isEmpty()) numbers.add(number);
        }
        if (numbers.isEmpty()) return matches.length() + " order match" + (matches.length() == 1 ? "" : "es");
        return "DataPlus order" + (numbers.size() == 1 ? " " : "s ") + String.join(", ", numbers);
    }

    private Dialog bottomDialog() {
        Dialog dialog = new Dialog(this, R.style.Theme_DataPlusWarehouse_BottomDialog);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setGravity(Gravity.BOTTOM);
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams params = window.getAttributes();
            params.dimAmount = 0.45f;
            window.setAttributes(params);
        }
        return dialog;
    }

    private void sizeBottomDialog(Dialog dialog) {
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            window.setGravity(Gravity.BOTTOM);
        }
    }

    private void showMore() {
        screen = SCREEN_MORE;
        bottomNav.setVisibility(View.VISIBLE);
        backButton.setVisibility(View.GONE);
        toolbarTitle.setText("More");
        updateNavSelection(SCREEN_MORE);
        ScrollView scroll = new ScrollView(this);
        LinearLayout page = Ui.column(this, 0);
        page.setPadding(Ui.dp(this, 14), Ui.dp(this, 18), Ui.dp(this, 14), Ui.dp(this, 30));
        page.addView(Ui.text(this, "Warehouse app", 24, Ui.TEXT, true));
        TextView subtitle = Ui.text(this, "Native scanner with DataPlus web tools available when needed.", 14, Ui.MUTED, false);
        Ui.margin(subtitle, 0, 5, 0, 18);
        page.addView(subtitle);

        LinearLayout card = Ui.card(this);
        card.addView(Ui.text(this, "DataPlus Warehouse 2.2.0", 17, Ui.TEXT, true));
        TextView device = Ui.text(this, "Optimized for G47 · Android " + Build.VERSION.RELEASE, 13, Ui.MUTED, false);
        Ui.margin(device, 0, 5, 0, 15);
        card.addView(device);
        Button full = Ui.button(this, "Open all warehouse tools", false);
        full.setOnClickListener(view -> openWeb("/warehouse/mobile"));
        card.addView(full, Ui.matchWrap());
        Button signOut = Ui.button(this, "Sign out", false);
        signOut.setTextColor(Ui.ERROR);
        signOut.setOnClickListener(view -> signOut());
        Ui.margin(signOut, 0, 9, 0, 0);
        card.addView(signOut, Ui.matchWrap());
        page.addView(card, Ui.matchWrap());
        scroll.addView(page);
        setScreen(scroll);
    }

    private void showAccountMenu(View anchor) {
        if (user == null) return;
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add("Refresh");
        menu.getMenu().add("Open full DataPlus");
        menu.getMenu().add("Sign out");
        menu.setOnMenuItemClickListener(item -> {
            String title = item.getTitle().toString();
            if ("Refresh".equals(title)) {
                if (SCREEN_OUTBOUND_SCANNER.equals(screen) && currentOutboundSession != null) openOutboundAudit(currentOutboundSession.optString("id"));
                else if (SCREEN_OUTBOUND.equals(screen)) showOutboundDashboard(true);
                else if (SCREEN_SCANNER.equals(screen) && currentAudit != null) openAudit(currentAudit.optString("id"));
                else showDashboard(dashboardMode, true);
            } else if ("Open full DataPlus".equals(title)) openWeb("/warehouse/mobile");
            else if ("Sign out".equals(title)) signOut();
            return true;
        });
        menu.show();
    }

    private void signOut() {
        showLoading("Signing out…");
        api.post("/api/auth/logout", new JSONObject(), new ApiClient.Callback() {
            @Override public void onSuccess(JSONObject response) { clearSession(); }
            @Override public void onError(ApiClient.ApiException error) { clearSession(); }
        });
    }

    private void clearSession() {
        api.clearCookies(() -> {
            user = null;
            currentAudit = null;
            audits = new JSONArray();
            warehouses = new JSONArray();
            outboundAudits = new JSONArray();
            currentOutboundSession = null;
            outboundScans = new JSONArray();
            activeOutboundPackage = null;
            showLogin();
        });
    }

    private void openWeb(String path) {
        Intent intent = new Intent(this, WebFallbackActivity.class);
        intent.putExtra(WebFallbackActivity.EXTRA_PATH, path);
        startActivity(intent);
    }

    private void showRetry(String title, String message, Runnable retry) {
        LinearLayout page = Ui.column(this, 0);
        page.setGravity(Gravity.CENTER);
        page.setPadding(Ui.dp(this, 24), Ui.dp(this, 32), Ui.dp(this, 24), Ui.dp(this, 32));
        LinearLayout card = Ui.card(this);
        TextView icon = Ui.text(this, "!", 28, Ui.ERROR, true);
        icon.setGravity(Gravity.CENTER);
        card.addView(icon, Ui.matchWrap());
        TextView heading = Ui.text(this, title, 19, Ui.TEXT, true);
        heading.setGravity(Gravity.CENTER);
        Ui.margin(heading, 0, 8, 0, 5);
        card.addView(heading);
        TextView detail = Ui.text(this, message == null ? "Try again." : message, 13, Ui.MUTED, false);
        detail.setGravity(Gravity.CENTER);
        Ui.margin(detail, 0, 0, 0, 16);
        card.addView(detail);
        Button button = Ui.button(this, "Try again", true);
        button.setOnClickListener(view -> retry.run());
        card.addView(button, Ui.matchWrap());
        page.addView(card, Ui.matchWrap());
        setScreen(page);
    }

    private void updateAccountLabel() {
        if (user == null) {
            accountButton.setText("Sign in");
            return;
        }
        String name = user.optString("firstName");
        if (name.isEmpty()) name = user.optString("name", user.optString("username", "Account"));
        accountButton.setText(name + "  ▾");
        accountButton.setVisibility(View.VISIBLE);
    }

    private void updateNavSelection(String active) {
        for (int index = 0; index < bottomNav.getChildCount(); index++) {
            View child = bottomNav.getChildAt(index);
            if (!(child instanceof TextView)) continue;
            boolean selected = active.equals(child.getTag());
            ((TextView) child).setTextColor(selected ? Ui.PRIMARY : Ui.MUTED);
            child.setBackground(selected ? Ui.rounded(0xFFEFF6FF, 14, this) : null);
        }
    }

    private void updateNetworkState() {
        boolean online = isOnline();
        offlineBanner.setVisibility(online ? View.GONE : View.VISIBLE);
        if (scannerStatus != null && isHardwareScannerScreen() && !online) {
            scannerStatus.setText("Offline — scanning is paused");
            scannerStatus.setTextColor(Ui.ERROR);
        }
        if (online) retryPendingOutboundPhotos();
    }

    private void watchNetworkState() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { runOnUiThread(LauncherActivity.this::updateNetworkState); }
            @Override public void onLost(Network network) { runOnUiThread(LauncherActivity.this::updateNetworkState); }
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                runOnUiThread(LauncherActivity.this::updateNetworkState);
            }
        };
        try { connectivityManager.registerDefaultNetworkCallback(networkCallback); }
        catch (Exception ignored) {}
    }

    private boolean isOnline() {
        ConnectivityManager manager = connectivityManager != null
            ? connectivityManager
            : (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        Network network = manager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void scannerMessage(String message, boolean pending) {
        if (scannerCapture != null) scannerCapture.setHint(message);
        if (scannerStatus != null) {
            scannerStatus.setText(pending ? "Checking DataPlus…" : message);
            scannerStatus.setTextColor(pending ? Ui.PRIMARY : Ui.ERROR);
        }
    }

    private void resetScanBuffer() {
        if (pendingScannerSubmit != null) scannerSubmitHandler.removeCallbacks(pendingScannerSubmit);
        pendingScannerSubmit = null;
        scanBuffer.setLength(0);
        lastScanKeyAt = 0;
        setScannerCaptureText("");
        if (scannerCapture != null && isHardwareScannerScreen()) scannerCapture.setHint(SCREEN_OUTBOUND.equals(screen) || (SCREEN_OUTBOUND_SCANNER.equals(screen) && activeOutboundPackage == null) ? "Waiting for tracking barcode" : "Waiting for barcode");
        if (scannerStatus != null && isHardwareScannerScreen()) {
            scannerStatus.setText("Scanner input active · press either G47 trigger");
            scannerStatus.setTextColor(Ui.SUCCESS);
        }
    }

    private EditText scannerCaptureField(String hint) {
        if (pendingScannerSubmit != null) scannerSubmitHandler.removeCallbacks(pendingScannerSubmit);
        pendingScannerSubmit = null;
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(16);
        input.setTextColor(Ui.TEXT);
        input.setHintTextColor(Ui.MUTED);
        input.setHint(hint);
        input.setTypeface(Typeface.MONOSPACE);
        input.setGravity(Gravity.CENTER_VERTICAL);
        input.setPadding(Ui.dp(this, 14), 0, Ui.dp(this, 14), 0);
        input.setBackground(Ui.bordered(0xFFF8FAFC, Ui.BORDER, 13, this));
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) input.setShowSoftInputOnFocus(false);
        input.setOnFocusChangeListener((view, hasFocus) -> { if (hasFocus) hideKeyboard(view); });
        input.setOnEditorActionListener((view, actionId, event) -> {
            boolean enter = event != null && (event.getKeyCode() == KeyEvent.KEYCODE_ENTER || event.getKeyCode() == KeyEvent.KEYCODE_NUMPAD_ENTER);
            if (actionId == EditorInfo.IME_ACTION_DONE || enter) {
                completeScannerCapture();
                return true;
            }
            return false;
        });
        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                if (updatingScannerCapture || scannerCapture != input) return;
                String raw = String.valueOf(value);
                if (raw.contains("\n") || raw.contains("\r") || raw.contains("\t")) completeScannerCapture();
                else if (normalizedScannerValue(raw).length() >= 3) scheduleScannerSubmit();
            }
            @Override public void afterTextChanged(Editable value) {}
        });
        return input;
    }

    private void setScannerCaptureText(String value) {
        if (scannerCapture == null) return;
        updatingScannerCapture = true;
        scannerCapture.setText(value == null ? "" : value);
        scannerCapture.setSelection(scannerCapture.length());
        updatingScannerCapture = false;
    }

    private void appendScannerCharacters(String characters) {
        boolean terminator = false;
        for (int index = 0; index < characters.length(); index++) {
            char value = characters.charAt(index);
            if (value == '\r' || value == '\n' || value == '\t') {
                terminator = true;
            } else if (Character.isLetterOrDigit(value) || value == '-' || value == ']') {
                scanBuffer.append(value);
            }
        }
        lastScanKeyAt = System.currentTimeMillis();
        setScannerCaptureText(scanBuffer.toString());
        if (terminator) completeScannerCapture();
        else scheduleScannerSubmit();
    }

    private void scheduleScannerSubmit() {
        if (pendingScannerSubmit != null) scannerSubmitHandler.removeCallbacks(pendingScannerSubmit);
        pendingScannerSubmit = () -> {
            pendingScannerSubmit = null;
            completeScannerCapture();
        };
        scannerSubmitHandler.postDelayed(pendingScannerSubmit, 120);
    }

    private void completeScannerCapture() {
        if (pendingScannerSubmit != null) scannerSubmitHandler.removeCallbacks(pendingScannerSubmit);
        pendingScannerSubmit = null;
        String barcode = scanBuffer.length() >= 3
            ? scanBuffer.toString()
            : scannerCapture == null ? "" : scannerCapture.getText().toString();
        barcode = normalizedScannerValue(barcode);
        resetScanBuffer();
        if (barcode.length() < 3) {
            if (System.currentTimeMillis() - lastCompletedScanAt < 1200) return;
            scannerMessage("No barcode received. Keep this field focused and scan again.", false);
            feedback(false);
            focusScanner();
            return;
        }
        if (busy) {
            scannerMessage("Still checking the previous scan. Try this package again.", false);
            feedback(false);
            focusScanner();
            return;
        }
        lastCompletedScanAt = System.currentTimeMillis();
        scannerMessage("Barcode received: " + barcode, true);
        handleHardwareScan(barcode);
    }

    private String normalizedScannerValue(String rawValue) {
        String value = rawValue == null ? "" : rawValue.trim();
        // Hardware imagers can prepend an AIM symbology identifier such as
        // ]C1 for Code 128 or ]Q3 for QR. It is not part of the identifier.
        value = value.replaceFirst("^\\][A-Za-z0-9]{2}", "");
        return value.replaceAll("[^0-9A-Za-z-]", "").trim();
    }

    private boolean isLikelyOutboundTracking(String rawValue) {
        String value = normalizedScannerValue(rawValue).replaceAll("[^0-9A-Za-z]", "").toUpperCase(Locale.US);
        if (value.isEmpty() || value.length() > 80) return false;
        if (value.matches("\\d{10,40}")) return true;
        if (value.matches("1Z[0-9A-Z]{16}")) return true;
        if (value.matches("[A-Z]{2}\\d{9}[A-Z]{2}")) return true;
        if (value.matches("(?:T\\d{10}|C\\d{14}|D\\d{14}|1LS[0-9A-Z]{8,}|TB[AMCD][0-9A-Z]{8,})")) return true;
        if (value.matches("(?:GM|JVGL|JJD|JD)[0-9A-Z]{8,}")) return true;
        if (value.matches("(?:SPX|SPD)[0-9A-Z]{8,}")) return true;
        if (value.matches("(?:GFUS[0-9A-Z]{10,}|GF[0-9A-Z]{10,}|GOFO[0-9A-Z]{6,})")) return true;
        if (value.matches("(?:SWX[0-9A-Z]{12,}|SWIFTX[0-9A-Z]{6,})")) return true;
        return value.matches("[A-Z]{2,6}[0-9A-Z]{10,}");
    }

    private void rejectNonTrackingBarcode(String barcode) {
        String preview = barcode.length() > 14 ? barcode.substring(0, 14) + "…" : barcode;
        scannerMessage("Ignored non-tracking barcode " + preview + ". Scan the carrier tracking barcode.", false);
        Toast.makeText(this, "Not a tracking barcode. Aim at the long barcode under the tracking number.", Toast.LENGTH_LONG).show();
        feedback(false);
        focusScanner();
    }

    private void focusScanner() {
        if (!isHardwareScannerScreen() || modalOpen) return;
        if (scannerCapture != null) {
            scannerCapture.setFocusableInTouchMode(true);
            scannerCapture.requestFocus();
            scannerCapture.setSelection(scannerCapture.length());
            hideKeyboard(scannerCapture);
        } else {
            contentHost.setFocusableInTouchMode(true);
            contentHost.requestFocus();
        }
    }

    private boolean isHardwareScannerScreen() {
        return SCREEN_SCANNER.equals(screen) || SCREEN_OUTBOUND.equals(screen) || SCREEN_OUTBOUND_SCANNER.equals(screen);
    }

    private void feedback(boolean success) {
        try {
            tones.startTone(success ? ToneGenerator.TONE_PROP_ACK : ToneGenerator.TONE_PROP_NACK, success ? 90 : 160);
            Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = success ? new long[]{0, 35} : new long[]{0, 80, 50, 80};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
                else vibrator.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {}
    }

    private void hideKeyboard(View view) {
        InputMethodManager manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (manager != null) manager.hideSoftInputFromWindow(view.getWindowToken(), 0);
    }

    private boolean isReceivingReason(String reason) {
        return "purchase_order_receipt".equals(reason) || "external_po_receipt".equals(reason) || "receiving_inventory".equals(reason);
    }

    private String reasonLabel(String reason) {
        switch (reason) {
            case "purchase_order_receipt": return "PO receiving";
            case "external_po_receipt": return "External PO receipt";
            case "receiving_inventory": return "Inbound receiving";
            case "cycle_count": return "Cycle count";
            case "new_inventory_onboarding": return "New inventory";
            case "extra_stock": return "Extra stock";
            default:
                if (reason == null || reason.trim().isEmpty()) return "Warehouse audit";
                return reason.replace('_', ' ');
        }
    }

    private String auditReference(JSONObject audit) {
        String number = audit.optString("auditNumber");
        if (number.isEmpty()) return "Warehouse audit";
        if (number.toUpperCase(Locale.US).startsWith("A-")) return number.toUpperCase(Locale.US);
        return "A-" + number;
    }

    private String auditProgressLabel(JSONObject audit) {
        JSONArray lines = audit.optJSONArray("lines");
        JSONArray unknowns = audit.optJSONArray("unknownBarcodes");
        int skuCount = lines == null ? 0 : lines.length();
        int units = 0;
        if (lines != null) {
            for (int index = 0; index < lines.length(); index++) {
                JSONObject line = lines.optJSONObject(index);
                if (line != null) units += Math.max(0, line.optInt("countedQty", line.optInt("count", 0)));
            }
        }
        return skuCount + " catalog SKU" + (skuCount == 1 ? "" : "s") + " · " + units + " unit" + (units == 1 ? "" : "s")
            + (unknowns != null && unknowns.length() > 0 ? " · " + unknowns.length() + " unknown" : "");
    }
}
