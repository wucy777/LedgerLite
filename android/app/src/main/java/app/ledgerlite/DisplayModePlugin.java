package app.ledgerlite;

import android.view.Display;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web layer ask for the display's fastest refresh mode. Devices that
 * only expose one mode simply resolve with supported=false.
 */
@CapacitorPlugin(name = "DisplayMode")
public class DisplayModePlugin extends Plugin {

    @PluginMethod
    public void setHighRefreshRate(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (getActivity() == null) {
            call.reject("Activity unavailable");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Window window = getActivity().getWindow();
                Display display = window.getDecorView().getDisplay();
                if (display == null) {
                    call.reject("Display unavailable");
                    return;
                }
                Display.Mode[] modes = display.getSupportedModes();
                Display.Mode target = display.getMode();
                float bestRate = target.getRefreshRate();
                for (Display.Mode mode : modes) {
                    if (enabled) {
                        if (mode.getRefreshRate() > bestRate + 0.01f) {
                            bestRate = mode.getRefreshRate();
                            target = mode;
                        }
                    } else if (mode.getRefreshRate() < bestRate - 0.01f) {
                        bestRate = mode.getRefreshRate();
                        target = mode;
                    }
                }
                WindowManager.LayoutParams params = window.getAttributes();
                params.preferredDisplayModeId = target.getModeId();
                window.setAttributes(params);

                JSObject result = new JSObject();
                result.put("supported", modes.length > 1);
                result.put("refreshRate", bestRate);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Unable to change the display mode", error);
            }
        });
    }
}
