package com.dataplus.warehouse;

import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ApiClient {
    static final String BASE_URL = "https://dataplusapp.duckdns.org";

    interface Callback {
        void onSuccess(JSONObject response);
        void onError(ApiException error);
    }

    static final class ApiException extends Exception {
        final int statusCode;

        ApiException(int statusCode, String message) {
            super(message);
            this.statusCode = statusCode;
        }

        boolean isUnauthorized() {
            return statusCode == HttpURLConnection.HTTP_UNAUTHORIZED;
        }
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final CookieManager cookieManager = CookieManager.getInstance();

    ApiClient() {
        cookieManager.setAcceptCookie(true);
    }

    void get(String path, Callback callback) {
        request("GET", path, null, callback);
    }

    void post(String path, JSONObject body, Callback callback) {
        request("POST", path, body == null ? new JSONObject() : body, callback);
    }

    void putBytes(String path, byte[] body, String contentType, Callback callback) {
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(BASE_URL + path);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("PUT");
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(45_000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "DataPlus-Warehouse-Android/2.3.0");
                connection.setRequestProperty("Content-Type", contentType);
                String cookies = cookieManager.getCookie(BASE_URL);
                if (cookies != null && !cookies.trim().isEmpty()) connection.setRequestProperty("Cookie", cookies);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }

                int status = connection.getResponseCode();
                storeResponseCookies(connection.getHeaderFields());
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String text = readStream(stream);
                JSONObject response = text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
                if (status >= 400) {
                    String message = response.optString("error", response.optString("message", "DataPlus upload failed."));
                    throw new ApiException(status, message);
                }
                mainHandler.post(() -> callback.onSuccess(response));
            } catch (ApiException error) {
                mainHandler.post(() -> callback.onError(error));
            } catch (JSONException error) {
                ApiException wrapped = new ApiException(0, "DataPlus returned an unreadable upload response.");
                mainHandler.post(() -> callback.onError(wrapped));
            } catch (Exception error) {
                ApiException wrapped = new ApiException(0, error.getMessage() == null ? "Unable to upload the package photo." : error.getMessage());
                mainHandler.post(() -> callback.onError(wrapped));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    void request(String method, String path, JSONObject body, Callback callback) {
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(BASE_URL + path);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(35_000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "DataPlus-Warehouse-Android/2.3.0");
                String cookies = cookieManager.getCookie(BASE_URL);
                if (cookies != null && !cookies.trim().isEmpty()) connection.setRequestProperty("Cookie", cookies);

                if (body != null) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(payload);
                    }
                }

                int status = connection.getResponseCode();
                storeResponseCookies(connection.getHeaderFields());
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String text = readStream(stream);
                JSONObject response = text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
                if (status >= 400) {
                    String message = response.optString("error", response.optString("message", "DataPlus request failed."));
                    throw new ApiException(status, message);
                }
                mainHandler.post(() -> callback.onSuccess(response));
            } catch (ApiException error) {
                mainHandler.post(() -> callback.onError(error));
            } catch (JSONException error) {
                ApiException wrapped = new ApiException(0, "DataPlus returned an unreadable response.");
                mainHandler.post(() -> callback.onError(wrapped));
            } catch (Exception error) {
                ApiException wrapped = new ApiException(0, error.getMessage() == null ? "Unable to reach DataPlus." : error.getMessage());
                mainHandler.post(() -> callback.onError(wrapped));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    void clearCookies(Runnable complete) {
        mainHandler.post(() -> cookieManager.removeAllCookies(removed -> {
            cookieManager.flush();
            complete.run();
        }));
    }

    private void storeResponseCookies(Map<String, List<String>> headers) {
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() == null || !"set-cookie".equalsIgnoreCase(entry.getKey())) continue;
            for (String cookie : entry.getValue()) cookieManager.setCookie(BASE_URL, cookie);
        }
        cookieManager.flush();
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line).append('\n');
        }
        return result.toString().trim();
    }
}
