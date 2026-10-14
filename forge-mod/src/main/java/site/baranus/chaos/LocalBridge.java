package site.baranus.chaos;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import net.minecraft.commands.CommandSource;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec2;
import net.minecraft.world.phys.Vec3;

/**
 * Локальный мост для одиночной игры (и сервера на этом же ПК): протокол RCON на 127.0.0.1:25585.
 * В одиночном мире настоящего RCON нет, поэтому приложение Baranus Chaos подключается сюда.
 * Слушает только loopback и выполняет только команды «baranuschaos ...».
 */
public final class LocalBridge {
    public static final int PORT = 25585;
    private static volatile ServerSocket listener;

    private LocalBridge() { }

    public static synchronized void start(MinecraftServer server) {
        stop();
        try {
            ServerSocket socket = new ServerSocket(PORT, 16, InetAddress.getLoopbackAddress());
            listener = socket;
            Thread thread = new Thread(() -> acceptLoop(socket, server), "Baranus Chaos bridge");
            thread.setDaemon(true);
            thread.start();
            BaranusChaosMod.LOGGER.info("Baranus Chaos: local bridge on 127.0.0.1:{}", PORT);
        } catch (IOException error) {
            BaranusChaosMod.LOGGER.warn("Baranus Chaos: port {} is busy, local bridge disabled ({})", PORT, error.getMessage());
        }
    }

    public static synchronized void stop() {
        ServerSocket socket = listener;
        listener = null;
        if (socket != null) try { socket.close(); } catch (IOException ignored) { }
    }

    private static void acceptLoop(ServerSocket socket, MinecraftServer server) {
        while (!socket.isClosed()) {
            try {
                Socket client = socket.accept();
                Thread worker = new Thread(() -> serve(client, server), "Baranus Chaos bridge client");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException error) {
                if (!socket.isClosed()) BaranusChaosMod.LOGGER.warn("Baranus Chaos bridge: {}", error.getMessage());
            }
        }
    }

    private static void serve(Socket client, MinecraftServer server) {
        try (client; DataInputStream in = new DataInputStream(client.getInputStream()); OutputStream out = client.getOutputStream()) {
            client.setSoTimeout(15_000);
            while (true) {
                int length = readIntLE(in);
                if (length < 10 || length > 4096) return;
                int id = readIntLE(in);
                int type = readIntLE(in);
                byte[] payload = new byte[length - 10];
                in.readFully(payload);
                in.readFully(new byte[2]);
                if (type == 3) {
                    write(out, id, 2, ""); // локальный мост: пароль не нужен
                } else if (type == 2) {
                    String command = new String(payload, StandardCharsets.UTF_8).trim();
                    write(out, id, 0, run(server, command));
                }
            }
        } catch (IOException ignored) {
            // клиент закрыл соединение
        }
    }

    private static String run(MinecraftServer server, String command) {
        if (!command.equals("baranuschaos") && !command.startsWith("baranuschaos ")) return "Unknown or incomplete command";
        try {
            return server.submit(() -> execute(server, command)).get(10, TimeUnit.SECONDS);
        } catch (Exception error) {
            return "BaranusChaos:ERROR failed";
        }
    }

    private static String execute(MinecraftServer server, String command) {
        StringBuilder output = new StringBuilder();
        CommandSource collector = new CommandSource() {
            @Override public void sendSystemMessage(Component message) { output.append(message.getString()).append('\n'); }
            @Override public boolean acceptsSuccess() { return true; }
            @Override public boolean acceptsFailure() { return true; }
            @Override public boolean shouldInformAdmins() { return false; }
        };
        ServerLevel level = server.overworld();
        CommandSourceStack source = new CommandSourceStack(collector, Vec3.atLowerCornerOf(level.getSharedSpawnPos()), Vec2.ZERO,
            level, 4, "BaranusBridge", Component.literal("Baranus Chaos"), server, null);
        server.getCommands().performPrefixedCommand(source, command);
        return output.toString().trim();
    }

    private static int readIntLE(InputStream in) throws IOException {
        byte[] bytes = new byte[4];
        new DataInputStream(in).readFully(bytes);
        return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).getInt();
    }

    private static void write(OutputStream out, int id, int type, String text) throws IOException {
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        if (body.length > 4000) body = java.util.Arrays.copyOf(body, 4000);
        ByteBuffer buffer = ByteBuffer.allocate(14 + body.length).order(ByteOrder.LITTLE_ENDIAN);
        buffer.putInt(10 + body.length).putInt(id).putInt(type).put(body).put((byte) 0).put((byte) 0);
        out.write(buffer.array());
        out.flush();
    }
}
