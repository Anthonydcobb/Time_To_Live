import com.cisco.pt.ipc.IPCFactory;
import com.cisco.pt.ipc.sim.Device;
import com.cisco.pt.ipc.sim.CiscoDevice;
import com.cisco.pt.ipc.sim.ConsoleLine;
import com.cisco.pt.ipc.sim.TerminalLine;
import com.cisco.pt.ipc.ui.IPC;
import com.cisco.pt.ptmp.PacketTracerSession;
import com.cisco.pt.ptmp.PacketTracerSessionFactory;
import com.cisco.pt.ptmp.impl.ConnectionNegotiationPropertiesImpl;
import com.cisco.pt.ptmp.impl.PacketTracerSessionFactoryImpl;
import com.cisco.pt.util.Pair;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class PacketTracerBridge {
    private static final Pattern FIELD = Pattern.compile("\\\"([^\\\"]+)\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"");

    private PacketTracerBridge() {}

    public static void main(String[] args) throws Exception {
        String ptHost = args.length > 0 ? args[0] : "127.0.0.1";
        int ptPort = args.length > 1 ? Integer.parseInt(args[1]) : 39000;
        int bridgePort = args.length > 2 ? Integer.parseInt(args[2]) : 39094;
        String bridge = "http://127.0.0.1:" + bridgePort;

        PacketTracerSessionFactory factory = PacketTracerSessionFactoryImpl.getInstance();
        PacketTracerSession session = null;
        try {
            ConnectionNegotiationPropertiesImpl properties = new ConnectionNegotiationPropertiesImpl();
            properties.setSignature("PTMP");
            properties.setVersion(1);
            properties.setEncoding(1);
            properties.setEncryption(1);
            properties.setCompression(1);
            properties.setAuthentication(4);
            properties.setAuthenticationApplication(System.getenv().getOrDefault(
                    "PT_TTL_AUTH_APPLICATION", "com.timetolive.network.bridge"));
            properties.setAuthenticationSecret(System.getenv().getOrDefault(
                    "PT_TTL_AUTH_SECRET", "CHANGE_ME_BEFORE_USE"));

            session = factory.openSession(ptHost, ptPort, properties);
            if (!session.isIpcReady()) throw new IllegalStateException("Packet Tracer IPC is not ready");

            IPC ipc = new IPCFactory(session).getIPC();
            HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
            System.out.println("PT bridge connected; polling " + bridge);

            while (!Thread.currentThread().isInterrupted()) {
                HttpResponse<String> response = http.send(HttpRequest.newBuilder()
                        .uri(URI.create(bridge + "/v1/commands/next"))
                        .timeout(Duration.ofSeconds(5))
                        .GET().build(), HttpResponse.BodyHandlers.ofString());

                if (response.statusCode() == 204) {
                    Thread.sleep(250);
                    continue;
                }
                if (response.statusCode() != 200) {
                    throw new IllegalStateException("Bridge command poll failed: HTTP " + response.statusCode());
                }

                String body = response.body();
                String id = field(body, "id");
                String deviceName = field(body, "device");
                String line = field(body, "line");
                String mode = field(body, "mode");
                if (id == null || deviceName == null || line == null) {
                    postResult(http, bridge, "", "STATUS_ERROR", "Malformed command: " + body);
                    continue;
                }

                String status = "STATUS_ERROR";
                String output;
                if ("__network__".equals(deviceName) && "list devices".equalsIgnoreCase(line)) {
                    StringBuilder devices = new StringBuilder();
                    for (int index = 0; index < ipc.network().getDeviceCount(); index++) {
                        Device listed = ipc.network().getDeviceAt(index);
                        if (listed != null) {
                            devices.append(listed.getName()).append("|")
                                    .append(listed.getType()).append("|")
                                    .append(listed.getModel()).append("|")
                                    .append(listed.getSerialNumber()).append("\n");
                        }
                    }
                    status = "STATUS_OK";
                    output = devices.toString();
                } else if ("__network__".equals(deviceName) && "list links".equalsIgnoreCase(line)) {
                    StringBuilder links = new StringBuilder();
                    for (int index = 0; index < ipc.network().getDeviceCount(); index++) {
                        Device listed = ipc.network().getDeviceAt(index);
                        if (listed == null) continue;
                        try {
                            for (int portIndex = 0; portIndex < listed.getPortCount(); portIndex++) {
                                try {
                                    com.cisco.pt.ipc.sim.Port port = listed.getPortAt(portIndex);
                                    if (port != null && port.getLink() != null) {
                                        links.append(listed.getName()).append("|")
                                                .append(port.getPortNameNumber()).append("|")
                                                .append(port.getRemotePortName()).append("|")
                                                .append(port.getLink().getConnectionType()).append("|")
                                                .append(port.isPortUp()).append("\n");
                                    }
                                } catch (RuntimeException ignored) {
                                    // Some non-network Packet Tracer devices expose ports
                                    // that do not support link inspection.
                                }
                            }
                        } catch (RuntimeException ignored) {
                            // Continue discovering links for the remaining devices.
                        }
                    }
                    status = "STATUS_OK";
                    output = links.toString();
                } else {
                    Device device = ipc.network().getDevice(deviceName);
                    if (device == null) {
                        output = "No device named " + deviceName;
                    } else if (device instanceof CiscoDevice) {
                        Pair<?, String> result = ((CiscoDevice) device).enterCommand(line, mode == null ? "" : mode);
                        status = String.valueOf(result.getFirst());
                        output = result.getSecond();
                    } else {
                        TerminalLine terminal = device.getCommandLine();
                        if (!(terminal instanceof ConsoleLine)) {
                            output = "Device does not expose a console command line: " + deviceName;
                        } else {
                            ConsoleLine console = (ConsoleLine) terminal;
                            String before = console.getOutput();
                            console.enterCommand(line);
                            status = "STATUS_OK";
                            String after = console.getOutput();
                            output = after.startsWith(before) ? after.substring(before.length()) : after;
                        }
                    }
                }
                postResult(http, bridge, id, status, output);
                System.out.println(deviceName + " <- " + line + " [" + status + "]");
            }
        } finally {
            if (session != null) session.close();
            factory.close();
        }
    }

    private static String field(String json, String name) {
        Matcher matcher = FIELD.matcher(json);
        while (matcher.find()) {
            if (matcher.group(1).equals(name)) return unescape(matcher.group(2));
        }
        return null;
    }

    private static String unescape(String value) {
        return value.replace("\\\\", "\\").replace("\\\"", "\"")
                .replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t");
    }

    private static void postResult(HttpClient http, String bridge, String id, String status, String output)
            throws Exception {
        String json = "{\"id\":\"" + escape(id) + "\",\"status\":\"" + escape(status)
                + "\",\"output\":\"" + escape(output == null ? "" : output) + "\"}";
        HttpResponse<String> response = http.send(HttpRequest.newBuilder()
                .uri(URI.create(bridge + "/v1/result"))
                .timeout(Duration.ofSeconds(5))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("Bridge result post failed: HTTP " + response.statusCode());
        }
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t");
    }
}
