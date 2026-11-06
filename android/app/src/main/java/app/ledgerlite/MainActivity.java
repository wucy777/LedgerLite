package app.ledgerlite;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DisplayModePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
