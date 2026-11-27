package com.dataplus.warehouse;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

final class Ui {
    static final int PRIMARY = Color.rgb(37, 99, 235);
    static final int PRIMARY_DARK = Color.rgb(30, 64, 175);
    static final int TEXT = Color.rgb(17, 24, 39);
    static final int MUTED = Color.rgb(107, 114, 128);
    static final int BORDER = Color.rgb(226, 232, 240);
    static final int BACKGROUND = Color.rgb(246, 247, 251);
    static final int SURFACE = Color.WHITE;
    static final int SUCCESS = Color.rgb(4, 120, 87);
    static final int SUCCESS_SOFT = Color.rgb(209, 250, 229);
    static final int WARNING = Color.rgb(180, 83, 9);
    static final int WARNING_SOFT = Color.rgb(254, 243, 199);
    static final int ERROR = Color.rgb(185, 28, 28);
    static final int ERROR_SOFT = Color.rgb(254, 226, 226);

    private Ui() {}

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static TextView text(Context context, String value, float sizeSp, int color, boolean bold) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans", bold ? Typeface.BOLD : Typeface.NORMAL));
        view.setLineSpacing(0, 1.08f);
        return view;
    }

    static LinearLayout column(Context context, int gapDp) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        if (gapDp > 0) layout.setShowDividers(LinearLayout.SHOW_DIVIDER_MIDDLE);
        return layout;
    }

    static LinearLayout row(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }

    static GradientDrawable rounded(int color, float radiusDp, Context context) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(context, radiusDp));
        return drawable;
    }

    static GradientDrawable bordered(int fill, int stroke, float radiusDp, Context context) {
        GradientDrawable drawable = rounded(fill, radiusDp, context);
        drawable.setStroke(dp(context, 1), stroke);
        return drawable;
    }

    static LinearLayout card(Context context) {
        LinearLayout card = column(context, 0);
        card.setBackground(bordered(SURFACE, BORDER, 16, context));
        card.setPadding(dp(context, 16), dp(context, 16), dp(context, 16), dp(context, 16));
        card.setElevation(dp(context, 1.5f));
        return card;
    }

    static Button button(Context context, String label, boolean primary) {
        Button button = new Button(context);
        button.setText(label);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setTypeface(Typeface.create("sans", Typeface.BOLD));
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(context, 50));
        button.setPadding(dp(context, 14), 0, dp(context, 14), 0);
        int fill = primary ? PRIMARY : SURFACE;
        int foreground = primary ? Color.WHITE : TEXT;
        GradientDrawable content = bordered(fill, primary ? PRIMARY : BORDER, 13, context);
        GradientDrawable mask = rounded(Color.WHITE, 13, context);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(primary ? 0x33FFFFFF : 0x14000000), content, mask));
        button.setTextColor(foreground);
        return button;
    }

    static TextView chip(Context context, String label, int foreground, int background) {
        TextView chip = text(context, label, 12, foreground, true);
        chip.setGravity(Gravity.CENTER);
        chip.setPadding(dp(context, 10), dp(context, 5), dp(context, 10), dp(context, 5));
        chip.setBackground(rounded(background, 99, context));
        return chip;
    }

    static LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    static LinearLayout.LayoutParams weight(float weight) {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight);
    }

    static void margin(View view, int left, int top, int right, int bottom) {
        ViewGroup.LayoutParams current = view.getLayoutParams();
        ViewGroup.MarginLayoutParams params = current instanceof ViewGroup.MarginLayoutParams
            ? (ViewGroup.MarginLayoutParams) current
            : new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(view.getContext(), left), dp(view.getContext(), top), dp(view.getContext(), right), dp(view.getContext(), bottom));
        view.setLayoutParams(params);
    }
}
