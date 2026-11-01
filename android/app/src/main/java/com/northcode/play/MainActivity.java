package com.northcode.play;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Activity principal do North Code Play baseada na BridgeActivity oficial do Capacitor 8.
 *
 * Comportamento por tipo de dispositivo Android:
 * - Identifica Android TV via UiModeManager (UI_MODE_TYPE_TELEVISION) ou PackageManager (FEATURE_LEANBACK).
 * - Na TV: configura o tamanho nativo de texto da WebView de forma previsível
 *   (textZoom = 100, minimumFontSize = 1, minimumLogicalFontSize = 1), permitindo que a
 *   calibração contínua da aplicação (50% a 125%) controle a escala sem bloqueio de fonte mínima,
 *   preservando o viewport real do dispositivo.
 * - Em celulares e tablets: preserva a adaptação natural de orientação e tamanho responsivo.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebViewForEnvironment();
    }

    private boolean isTelevisionDevice() {
        try {
            UiModeManager uiModeManager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (uiModeManager != null
                    && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                return true;
            }
            PackageManager pm = getPackageManager();
            if (pm != null && pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) {
                return true;
            }
        } catch (Exception ignored) {
            // Preserve default mobile behavior if inspection fails
        }
        return false;
    }

    private void configureWebViewForEnvironment() {
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }

        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }

        webView.setBackgroundColor(Color.BLACK);

        WebSettings settings = webView.getSettings();
        if (settings == null) {
            return;
        }

        // Permite reprodução direta de streams HLS/MP4 e carregamento de canais HTTP/HTTPS
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setDomStorageEnabled(true);

        if (isTelevisionDevice()) {
            // Configurações exclusivas quando o Android identifica uma televisão:
            // Garante tamanho nativo de texto previsível (100% sem piso de minimumFontSize)
            // para que a calibração da própria aplicação (50% a 125%) funcione diretamente.
            settings.setTextZoom(100);
            settings.setMinimumFontSize(1);
            settings.setMinimumLogicalFontSize(1);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
        } else {
            // Em celulares e tablets: preserva o comportamento responsivo e orientação natural
            settings.setTextZoom(100);
        }
    }
}
