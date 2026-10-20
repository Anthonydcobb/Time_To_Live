function main() {
    var net = network();
    var device = net.getDeviceAt(0);

    if (!device) {
        dprint("No device found.");
        return;
    }

    dprint("Found device: " + device.getName());

    var result = device.enterCommand(
        "show spanning-tree",
        "enable"
    );

    dprint("Command result:");
    dprint(result);
}