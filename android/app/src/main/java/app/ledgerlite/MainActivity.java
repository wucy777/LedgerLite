package app.ledgerlite;

import android.os.Bundle;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * Hosts the WebView and hands Android's predictive-back gesture to the web layer.
 *
 * On Android 14+ the system streams an edge swipe as start/progress/cancel/commit
 * callbacks; older releases only deliver the discrete back event. Both feed the
 * same `__ledgerBack*` bridge in TypeScript, so the in-app back stack (close
 * overlay → return to 明细 → double-back to exit) behaves identically.
 */
public class MainActivity extends BridgeActivity {

    private long lastCommitAt = 0L;

    private void emit(String script) {
        if (bridge == null) return;
        bridge.eval(script, null);
    }

    /** Runs the web back stack; finishes the activity only when the web layer is gone. */
    private void commit() {
        long now = System.currentTimeMillis();
        if (now - lastCommitAt < 250L) return;
        lastCommitAt = now;
        if (bridge == null) {
            finish();
            return;
        }
        bridge.eval(
            "(function(){ try { if (typeof window.__ledgerBack === 'function') { window.__ledgerBack(); return '1'; } } catch (e) {} return '0'; })()",
            value -> {
                if (value == null || !value.contains("1")) finish();
            }
        );
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DisplayModePlugin.class);
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackStarted(BackEventCompat backEvent) {
                    emit("window.__ledgerBackStart && window.__ledgerBackStart()");
                }

                @Override
                public void handleOnBackProgressed(BackEventCompat backEvent) {
                    emit(
                        "window.__ledgerBackProgress && window.__ledgerBackProgress("
                            + backEvent.getProgress()
                            + ")"
                    );
                }

                @Override
                public void handleOnBackCancelled() {
                    emit("window.__ledgerBackCancel && window.__ledgerBackCancel()");
                }

                @Override
                public void handleOnBackPressed() {
                    commit();
                }
            }
        );
    }
}
