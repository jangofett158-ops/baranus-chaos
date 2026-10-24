package site.baranus.chaos;

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/**
 * Состояние мода в мире: пауза хаоса, общие настройки событий для всех подключённых приложений
 * (синхронизация двух стримеров), доступ друга по сети (Radmin VPN) и учёт очереди событий.
 */
public final class ChaosState extends SavedData {
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int MAX_CONFIG = 256_000;

    private boolean paused;
    private String config = "";
    private int revision;
    private boolean remote;
    private String accessCode = "";
    // Ивенты с отдельными командами для первого доната, которые в этом мире уже срабатывали.
    private final java.util.Set<String> firstDone = new java.util.TreeSet<>();

    // Очередь не сохраняется в мир: последнее событие вообще и по каждому коду (мс).
    private long lastEventAt;
    private final Map<String, Long> lastByCode = new HashMap<>();
    // Незавершённые загрузки настроек: id → части.
    private final Map<String, String[]> uploads = new HashMap<>();

    public static ChaosState get(MinecraftServer server) {
        return server.overworld().getDataStorage().computeIfAbsent(ChaosState::load, ChaosState::new, "baranuschaos_state");
    }

    private static ChaosState load(CompoundTag tag) {
        ChaosState state = new ChaosState();
        state.paused = tag.getBoolean("Paused");
        state.config = tag.getString("Config");
        state.revision = tag.getInt("Revision");
        state.remote = tag.getBoolean("Remote");
        state.accessCode = tag.getString("AccessCode");
        for (String code : tag.getString("FirstDone").split(",")) if (!code.isEmpty()) state.firstDone.add(code);
        return state;
    }

    @Override
    public CompoundTag save(CompoundTag tag) {
        tag.putBoolean("Paused", paused);
        tag.putString("Config", config);
        tag.putInt("Revision", revision);
        tag.putBoolean("Remote", remote);
        tag.putString("AccessCode", accessCode);
        tag.putString("FirstDone", String.join(",", firstDone));
        return tag;
    }

    // ---------- Первый донат ----------
    /** true - ивент с командами «для первого доната» в этом мире ещё не срабатывал. */
    public synchronized boolean isFirst(String code) { return !firstDone.contains(code); }

    public synchronized void setFirstDone(String code, boolean done) {
        if (done ? firstDone.add(code) : firstDone.remove(code)) setDirty();
    }

    public boolean paused() { return paused; }

    public void setPaused(boolean value) {
        paused = value;
        setDirty();
    }

    // ---------- Общие настройки ----------
    public int revision() { return revision; }
    public String config() { return config; }

    /**
     * Часть загрузки настроек. Возвращает новую ревизию, когда пришли все части, иначе -1.
     * expect >= 0 - ревизия, на которой основана запись: если мир уже другой (второй стример успел сохранить
     * свои правки), запись отклоняется с «conflict», и приложение сливает правки заново.
     */
    public synchronized int putPart(String uploadId, int index, int total, String data, int expect) {
        if (total < 1 || total > 256 || index < 0 || index >= total) throw new IllegalArgumentException("bad-part");
        String[] parts = uploads.computeIfAbsent(uploadId, id -> new String[total]);
        if (parts.length != total) throw new IllegalArgumentException("bad-part");
        parts[index] = data;
        for (String part : parts) if (part == null) return -1;
        uploads.remove(uploadId);
        if (expect >= 0 && expect != revision) throw new IllegalArgumentException("conflict");
        String joined = String.join("", parts);
        if (joined.length() > MAX_CONFIG) throw new IllegalArgumentException("too-big");
        config = joined;
        revision++;
        setDirty();
        return revision;
    }

    /** Настройки, изменённые в самой игре (меню событий): новая ревизия, приложения подтянут её сами. */
    public synchronized int replaceConfig(String encoded) {
        if (encoded.length() > MAX_CONFIG) throw new IllegalArgumentException("too-big");
        config = encoded;
        revision++;
        setDirty();
        return revision;
    }

    // ---------- Доступ друга (Radmin) ----------
    public boolean remote() { return remote; }

    public String accessCode() {
        if (accessCode.isEmpty()) {
            SecureRandom random = new SecureRandom();
            StringBuilder code = new StringBuilder();
            for (int i = 0; i < 8; i++) code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
            accessCode = code.toString();
            setDirty();
        }
        return accessCode;
    }

    public void setRemote(boolean value) {
        remote = value;
        accessCode();
        setDirty();
    }

    // ---------- Очередь ----------
    /** Можно ли запускать событие сейчас: пауза между любыми событиями (gap) и перезарядка этого события. 0 — да, иначе сколько ждать (мс). */
    public synchronized long claim(String code, int gapSeconds, int cooldownSeconds) {
        long now = System.currentTimeMillis();
        long waitGap = lastEventAt + gapSeconds * 1000L - now;
        long waitCooldown = lastByCode.getOrDefault(code, 0L) + cooldownSeconds * 1000L - now;
        long wait = Math.max(waitGap, waitCooldown);
        if (wait > 0) return wait;
        lastEventAt = now;
        lastByCode.put(code, now);
        return 0;
    }
}
