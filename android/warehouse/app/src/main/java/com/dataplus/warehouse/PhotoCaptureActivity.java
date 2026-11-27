package com.dataplus.warehouse;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Size;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

public final class PhotoCaptureActivity extends Activity {
    static final String EXTRA_PHOTO_PATH = "photoPath";
    static final String EXTRA_PHOTO_WIDTH = "photoWidth";
    static final String EXTRA_PHOTO_HEIGHT = "photoHeight";
    static final String EXTRA_ERROR = "photoError";

    private static final int CAMERA_PERMISSION_REQUEST = 7402;
    private static final String CAMERA_PREFERENCE = "warehouse.package-photo-camera-id.v1";
    private TextureView textureView;
    private Button captureButton;
    private Button cameraButton;
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private CaptureRequest.Builder previewRequest;
    private ImageReader imageReader;
    private String cameraId = "";
    private Size captureSize;
    private Size previewSize;
    private int sensorOrientation;
    private final List<CameraOption> cameraOptions = new ArrayList<>();
    private boolean openingCamera;
    private boolean finishingCapture;

    private final TextureView.SurfaceTextureListener textureListener = new TextureView.SurfaceTextureListener() {
        @Override public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
            configureTransform(width, height);
            openRegularRearCamera();
        }
        @Override public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
            configureTransform(width, height);
        }
        @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) { return true; }
        @Override public void onSurfaceTextureUpdated(SurfaceTexture surface) {}
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        buildCameraUi();
    }

    private void buildCameraUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        textureView = new TextureView(this);
        textureView.setSurfaceTextureListener(textureListener);
        root.addView(textureView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12));
        header.setBackgroundColor(0x99000000);
        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setTextColor(Color.WHITE);
        cancel.setTextSize(15);
        cancel.setAllCaps(false);
        cancel.setBackgroundColor(Color.TRANSPARENT);
        cancel.setOnClickListener(view -> finish());
        header.addView(cancel, new LinearLayout.LayoutParams(Ui.dp(this, 92), Ui.dp(this, 48)));
        TextView title = new TextView(this);
        title.setText("Package photo");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1));
        cameraButton = new Button(this);
        cameraButton.setText("Camera");
        cameraButton.setTextColor(Color.WHITE);
        cameraButton.setTextSize(14);
        cameraButton.setAllCaps(false);
        cameraButton.setBackgroundColor(Color.TRANSPARENT);
        cameraButton.setOnClickListener(view -> showCameraPicker());
        header.addView(cameraButton, new LinearLayout.LayoutParams(Ui.dp(this, 92), Ui.dp(this, 48)));
        FrameLayout.LayoutParams headerParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        root.addView(header, headerParams);

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setGravity(Gravity.CENTER);
        footer.setPadding(Ui.dp(this, 20), Ui.dp(this, 14), Ui.dp(this, 20), Ui.dp(this, 24));
        footer.setBackgroundColor(0x99000000);
        TextView hint = new TextView(this);
        hint.setText("Optional · photograph the package or label");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(14);
        hint.setGravity(Gravity.CENTER);
        footer.addView(hint, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        captureButton = new Button(this);
        captureButton.setText("Take photo");
        captureButton.setTextSize(17);
        captureButton.setTextColor(Color.WHITE);
        captureButton.setAllCaps(false);
        captureButton.setEnabled(false);
        captureButton.setBackground(Ui.rounded(Ui.PRIMARY, 16, this));
        captureButton.setOnClickListener(view -> capturePhoto());
        LinearLayout.LayoutParams captureParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 58));
        captureParams.setMargins(0, Ui.dp(this, 12), 0, 0);
        footer.addView(captureButton, captureParams);
        FrameLayout.LayoutParams footerParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        root.addView(footer, footerParams);
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        startCameraThread();
        if (textureView.isAvailable()) {
            configureTransform(textureView.getWidth(), textureView.getHeight());
            openRegularRearCamera();
        }
    }

    @Override
    protected void onPause() {
        closeCamera();
        stopCameraThread();
        super.onPause();
    }

    private void startCameraThread() {
        cameraThread = new HandlerThread("DataPlusPackageCamera");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
    }

    private void stopCameraThread() {
        if (cameraThread == null) return;
        cameraThread.quitSafely();
        try { cameraThread.join(); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        cameraThread = null;
        cameraHandler = null;
    }

    private void openRegularRearCamera() {
        if (openingCamera || cameraDevice != null || cameraHandler == null) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
            return;
        }
        try {
            chooseRegularRearCamera();
            if (cameraId.isEmpty() || captureSize == null || previewSize == null) {
                failAndFinish("No regular rear camera is available on this device.");
                return;
            }
            configureTransform(textureView.getWidth(), textureView.getHeight());
            imageReader = ImageReader.newInstance(captureSize.getWidth(), captureSize.getHeight(), android.graphics.ImageFormat.JPEG, 2);
            imageReader.setOnImageAvailableListener(this::saveCapturedImage, cameraHandler);
            openingCamera = true;
            CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice camera) {
                    openingCamera = false;
                    cameraDevice = camera;
                    createPreviewSession();
                }
                @Override public void onDisconnected(CameraDevice camera) {
                    openingCamera = false;
                    camera.close();
                    cameraDevice = null;
                    failAndFinish("The rear camera disconnected.");
                }
                @Override public void onError(CameraDevice camera, int error) {
                    openingCamera = false;
                    camera.close();
                    cameraDevice = null;
                    failAndFinish("The regular rear camera could not be opened.");
                }
            }, cameraHandler);
        } catch (Exception error) {
            openingCamera = false;
            failAndFinish(error.getMessage() == null ? "Unable to open the regular rear camera." : error.getMessage());
        }
    }

    private void chooseRegularRearCamera() throws CameraAccessException {
        CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
        cameraOptions.clear();
        for (String id : manager.getCameraIdList()) {
            CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
            Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
            StreamConfigurationMap map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size[] jpegSizes = map == null ? null : map.getOutputSizes(android.graphics.ImageFormat.JPEG);
            Size[] previewSizes = map == null ? null : map.getOutputSizes(SurfaceTexture.class);
            if (jpegSizes == null || jpegSizes.length == 0 || previewSizes == null || previewSizes.length == 0) continue;
            boolean monochrome = false;
            int[] capabilities = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
            if (capabilities != null) {
                for (int capability : capabilities) {
                    if (capability == CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MONOCHROME) monochrome = true;
                }
            }
            Size candidateCapture = chooseCaptureSize(jpegSizes);
            Size candidatePreview = choosePreviewSize(previewSizes, candidateCapture);
            long area = (long) candidateCapture.getWidth() * candidateCapture.getHeight();
            long score = area;
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) score += 4_000_000_000_000L;
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) score -= 4_000_000_000_000L;
            if (monochrome) score -= 8_000_000_000_000L;
            Integer orientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
            cameraOptions.add(new CameraOption(id, facing, monochrome, candidateCapture, candidatePreview, orientation == null ? 90 : orientation, score));
        }
        cameraOptions.sort((left, right) -> Long.compare(right.score, left.score));
        if (cameraOptions.isEmpty()) return;
        String savedCamera = getSharedPreferences("warehouse_native", MODE_PRIVATE).getString(CAMERA_PREFERENCE, "");
        CameraOption selected = cameraOptions.get(0);
        for (CameraOption option : cameraOptions) if (option.id.equals(savedCamera)) selected = option;
        applyCameraOption(selected);
    }

    private void applyCameraOption(CameraOption option) {
        cameraId = option.id;
        captureSize = option.capture;
        previewSize = option.preview;
        sensorOrientation = option.sensorOrientation;
        cameraButton.setText("Camera");
        cameraButton.setContentDescription("Choose default camera. Current: " + option.label(false));
    }

    private void showCameraPicker() {
        try {
            if (cameraOptions.isEmpty()) chooseRegularRearCamera();
        } catch (CameraAccessException error) {
            Toast.makeText(this, "Unable to list this device's cameras.", Toast.LENGTH_LONG).show();
            return;
        }
        if (cameraOptions.isEmpty()) {
            Toast.makeText(this, "No package camera is available.", Toast.LENGTH_LONG).show();
            return;
        }
        String[] labels = new String[cameraOptions.size()];
        int checked = 0;
        for (int index = 0; index < cameraOptions.size(); index++) {
            CameraOption option = cameraOptions.get(index);
            labels[index] = option.label(index == 0);
            if (option.id.equals(cameraId)) checked = index;
        }
        new AlertDialog.Builder(this)
            .setTitle("Default package camera")
            .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                CameraOption selected = cameraOptions.get(which);
                getSharedPreferences("warehouse_native", MODE_PRIVATE).edit().putString(CAMERA_PREFERENCE, selected.id).apply();
                dialog.dismiss();
                captureButton.setEnabled(false);
                captureButton.setText("Switching camera…");
                closeCamera();
                applyCameraOption(selected);
                Toast.makeText(this, "Default package camera saved.", Toast.LENGTH_SHORT).show();
                openRegularRearCamera();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    private static Size chooseCaptureSize(Size[] sizes) {
        Size best = null;
        for (Size size : sizes) {
            long area = (long) size.getWidth() * size.getHeight();
            int largestSide = Math.max(size.getWidth(), size.getHeight());
            if (largestSide > 2048 || area > 3_000_000L) continue;
            if (best == null || area > (long) best.getWidth() * best.getHeight()) best = size;
        }
        if (best != null) return best;
        return Arrays.stream(sizes).min(Comparator.comparingLong(size -> (long) size.getWidth() * size.getHeight())).orElse(sizes[0]);
    }

    private static Size choosePreviewSize(Size[] sizes, Size capture) {
        double targetRatio = (double) capture.getWidth() / capture.getHeight();
        Size best = sizes[0];
        double bestScore = Double.MAX_VALUE;
        for (Size size : sizes) {
            int largestSide = Math.max(size.getWidth(), size.getHeight());
            if (largestSide > 1920) continue;
            double ratio = (double) size.getWidth() / size.getHeight();
            double score = Math.abs(targetRatio - ratio) * 10_000_000d - (double) size.getWidth() * size.getHeight();
            if (score < bestScore) { bestScore = score; best = size; }
        }
        return best;
    }

    private static final class CameraOption {
        final String id;
        final Integer facing;
        final boolean monochrome;
        final Size capture;
        final Size preview;
        final int sensorOrientation;
        final long score;

        CameraOption(String id, Integer facing, boolean monochrome, Size capture, Size preview, int sensorOrientation, long score) {
            this.id = id;
            this.facing = facing;
            this.monochrome = monochrome;
            this.capture = capture;
            this.preview = preview;
            this.sensorOrientation = sensorOrientation;
            this.score = score;
        }

        String label(boolean recommended) {
            String position = facing != null && facing == CameraCharacteristics.LENS_FACING_BACK ? "Rear"
                : facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT ? "Front" : "External";
            String color = monochrome ? "monochrome / scanner" : "color";
            double megapixels = ((double) capture.getWidth() * capture.getHeight()) / 1_000_000d;
            return String.format(Locale.US, "%s %s · %.1f MP%s", position, color, megapixels, recommended ? " · recommended" : "");
        }
    }

    private void createPreviewSession() {
        if (cameraDevice == null || !textureView.isAvailable() || previewSize == null || imageReader == null) return;
        try {
            SurfaceTexture texture = textureView.getSurfaceTexture();
            if (texture == null) return;
            texture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
            Surface previewSurface = new Surface(texture);
            previewRequest = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            previewRequest.addTarget(previewSurface);
            previewRequest.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            previewRequest.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
            cameraDevice.createCaptureSession(Arrays.asList(previewSurface, imageReader.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override public void onConfigured(CameraCaptureSession session) {
                    if (cameraDevice == null) return;
                    captureSession = session;
                    try {
                        captureSession.setRepeatingRequest(previewRequest.build(), null, cameraHandler);
                        runOnUiThread(() -> captureButton.setEnabled(true));
                    } catch (CameraAccessException error) {
                        failAndFinish("Unable to start the camera preview.");
                    }
                }
                @Override public void onConfigureFailed(CameraCaptureSession session) {
                    failAndFinish("Unable to start the regular rear camera preview.");
                }
            }, cameraHandler);
        } catch (CameraAccessException error) {
            failAndFinish("Unable to start the camera preview.");
        }
    }

    private void capturePhoto() {
        if (cameraDevice == null || captureSession == null || imageReader == null || finishingCapture) return;
        finishingCapture = true;
        captureButton.setEnabled(false);
        captureButton.setText("Saving…");
        try {
            CaptureRequest.Builder still = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            still.addTarget(imageReader.getSurface());
            still.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            still.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
            still.set(CaptureRequest.JPEG_QUALITY, (byte) 84);
            still.set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation());
            captureSession.capture(still.build(), null, cameraHandler);
        } catch (CameraAccessException error) {
            finishingCapture = false;
            captureButton.setEnabled(true);
            captureButton.setText("Take photo");
            Toast.makeText(this, "Unable to take the photo. Try again.", Toast.LENGTH_LONG).show();
        }
    }

    private int jpegOrientation() {
        int rotation = getWindowManager().getDefaultDisplay().getRotation();
        int device = rotation == Surface.ROTATION_90 ? 0 : rotation == Surface.ROTATION_180 ? 270 : rotation == Surface.ROTATION_270 ? 180 : 90;
        return (device + sensorOrientation + 270) % 360;
    }

    private void saveCapturedImage(ImageReader reader) {
        Image image = reader.acquireLatestImage();
        if (image == null) return;
        try {
            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);
            File directory = new File(getCacheDir(), "outbound-photos");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Unable to prepare photo storage.");
            File file = new File(directory, "package-" + java.util.UUID.randomUUID() + ".jpg");
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
            Intent result = new Intent();
            result.putExtra(EXTRA_PHOTO_PATH, file.getAbsolutePath());
            result.putExtra(EXTRA_PHOTO_WIDTH, captureSize.getWidth());
            result.putExtra(EXTRA_PHOTO_HEIGHT, captureSize.getHeight());
            runOnUiThread(() -> {
                setResult(RESULT_OK, result);
                finish();
            });
        } catch (Exception error) {
            failAndFinish(error.getMessage() == null ? "Unable to save the package photo." : error.getMessage());
        } finally {
            image.close();
        }
    }

    private void configureTransform(int viewWidth, int viewHeight) {
        if (previewSize == null || viewWidth == 0 || viewHeight == 0) return;
        int rotation = getWindowManager().getDefaultDisplay().getRotation();
        Matrix matrix = new Matrix();
        RectF viewRect = new RectF(0, 0, viewWidth, viewHeight);
        RectF bufferRect = new RectF(0, 0, previewSize.getHeight(), previewSize.getWidth());
        float centerX = viewRect.centerX();
        float centerY = viewRect.centerY();
        if (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270) {
            bufferRect.offset(centerX - bufferRect.centerX(), centerY - bufferRect.centerY());
            matrix.setRectToRect(viewRect, bufferRect, Matrix.ScaleToFit.FILL);
            float scale = Math.max((float) viewHeight / previewSize.getHeight(), (float) viewWidth / previewSize.getWidth());
            matrix.postScale(scale, scale, centerX, centerY);
            matrix.postRotate(90f * (rotation - 2), centerX, centerY);
        } else if (rotation == Surface.ROTATION_180) {
            matrix.postRotate(180, centerX, centerY);
        }
        textureView.setTransform(matrix);
    }

    private void closeCamera() {
        if (captureSession != null) { captureSession.close(); captureSession = null; }
        if (cameraDevice != null) { cameraDevice.close(); cameraDevice = null; }
        if (imageReader != null) { imageReader.close(); imageReader = null; }
        openingCamera = false;
    }

    private void failAndFinish(String message) {
        runOnUiThread(() -> {
            Intent result = new Intent();
            result.putExtra(EXTRA_ERROR, message);
            setResult(RESULT_CANCELED, result);
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            finish();
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) openRegularRearCamera();
        else failAndFinish("Camera permission is required to take an optional package photo.");
    }
}
