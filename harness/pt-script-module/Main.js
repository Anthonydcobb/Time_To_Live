function main() {
    dprint("PT bridge command handler ready");
    var bridgeView = webViewManager.createWebView("PT Bridge", "this-sm:Bridge2.htm", 600, 400);
    bridgeView.show();
}

function executeCommand(webViewId, callbackFunc, id, deviceName, line, mode) {
    var device = ipc.network().getDevice(deviceName);
    var result;

    if (!device) {
        result = { first: 4, second: "No device named " + deviceName };
    } else {
        result = device.enterCommand(line, mode || "");
    }

    var webView = webViewManager.getWebView(webViewId);
    $wvca(webView, callbackFunc, id, result.first, result.second);
}
