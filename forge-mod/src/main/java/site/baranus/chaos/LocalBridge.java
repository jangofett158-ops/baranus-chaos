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
 * Мост для приложения Baranus Chaos: протокол RCON на порту 25585 (в одиночном мире настоящего RCON нет).
 * По умолчанию слушает только этот ПК (127.0.0.1) и пускает без пароля. Если хозяин включил «доступ друга»
 * (совместная игра через Radmin VPN), слушает все адреса, а подключения не с этого ПК пускает только с кодом доступа.
 * Выполняет только команды «baranuschaos ...».
 */
public final class LocalBridge {
    public static final int PORT = 25585;
    private static volatile ServerSocket listener;

    private LocalBridge() { }

    public static synchronized void start(MinecraftServer server) {
        stop();
        try {
            boolean remote = ChaosState.get(server).remote();
            ServerSocket socket = remote ? new ServerSocket(PORT, 16) : new ServerSocket(PORT, 16, InetAddress.getLoopbackAddress());
            listener = socket;
            Thread thread = new Thread(() -> acceptLoop(socket, server), "Baranus Chaos bridge");
            thread.setDaemon(true);
            thread.start();
            BaranusChaosMod.LOGGER.info("Baranus Chaos: bridge on {}:{}", remote ? "0.0.0.0" : "127.0.0.1", PORT);
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
        boolean local = client.getInetAddress().isLoopbackAddress();
        boolean authed = local;
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
                    // С этого ПК — без пароля; по сети — только с кодом доступа из приложения хозяина.
                    if (!local) {
                        String password = new String(payload, StandardCharsets.UTF_8).trim().toUpperCase(java.util.Locale.ROOT);
                        authed = ChaosState.get(server).remote() && password.equals(ChaosState.get(server).accessCode());
                        if (!authed) Thread.sleep(800); // замедляем подбор кода
                    }
                    write(out, authed ? id : -1, 2, "");
                    if (!authed) return;
                } else if (type == 2) {
                    if (!authed) return;
                    String command = new String(payload, StandardCharsets.UTF_8).trim();
                    write(out, id, 0, run(server, command));
                }
            }
        } catch (IOException | InterruptedException ignored) {
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
