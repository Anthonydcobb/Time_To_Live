import com.cisco.pt.ipc.IPCFactory;
import com.cisco.pt.ipc.sim.Device;
import com.cisco.pt.ipc.ui.IPC;
import com.cisco.pt.ptmp.PacketTracerSession;
import com.cisco.pt.ptmp.PacketTracerSessionFactory;
import com.cisco.pt.ptmp.impl.ConnectionNegotiationPropertiesImpl;
import com.cisco.pt.ptmp.impl.PacketTracerSessionFactoryImpl;
import com.cisco.pt.util.Pair;

public final class PacketTracerSmoke {
    private PacketTracerSmoke() {}

    public static void main(String[] args) throws Exception {
        String host = args.length > 0 ? args[0] : "127.0.0.1";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 39000;
        String command = args.length > 2 ? args[2] : "show spanning-tree";
        String application = System.getenv().getOrDefault(
                "PT_TTL_AUTH_APPLICATION", "com.timetolive.network.bridge");
        String secret = System.getenv().getOrDefault(
                "PT_TTL_AUTH_SECRET", "CHANGE_ME_BEFORE_USE");

        PacketTracerSessionFactory factory = PacketTracerSessionFactoryImpl.getInstance();
        PacketTracerSession session = null;
        try {
            ConnectionNegotiationPropertiesImpl properties =
                    new ConnectionNegotiationPropertiesImpl();
            properties.setSignature("PTMP");
            properties.setVersion(1);
            properties.setEncoding(1);
            properties.setEncryption(1);
            properties.setCompression(1);
            properties.setAuthentication(4);
            properties.setAuthenticationApplication(application);
            properties.setAuthenticationSecret(secret);
            session = factory.openSession(host, port, properties);
            long deadline = System.currentTimeMillis() + 5000;
            while (!session.isIpcReady() && System.currentTimeMillis() < deadline) {
                Thread.sleep(50);
            }
            if (!session.isIpcReady()) {
                throw new IllegalStateException("Packet Tracer IPC session did not become ready");
            }

            IPC ipc = new IPCFactory(session).getIPC();
            Device device = ipc.network().getDeviceAt(0);
            if (device == null) {
                throw new IllegalStateException("Packet Tracer returned no devices");
            }

            System.out.println("Found device: " + device.getName());
            if (!(device instanceof com.cisco.pt.ipc.sim.CiscoDevice)) {
                throw new IllegalStateException("First device is not a Cisco CLI device");
            }

            com.cisco.pt.ipc.sim.CiscoDevice ciscoDevice =
                    (com.cisco.pt.ipc.sim.CiscoDevice) device;
            Pair<?, String> result = ciscoDevice.enterCommand(command, "enable");
            System.out.println("Command result:");
            System.out.println("Status: " + result.getFirst());
            System.out.println(result.getSecond());
        } finally {
            if (session != null) {
                session.close();
            }
            factory.close();
        }
    }
}
