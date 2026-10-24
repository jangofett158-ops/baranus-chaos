package site.baranus.chaos;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import net.minecraft.server.MinecraftServer;

/**
 * События для меню в игре: встроенные (как в каталоге приложения, lib/catalog.mjs) плюс свои,
 * с ценами, названиями и включённостью из общих настроек, которые приложение хранит в мире.
 */
public final class ChaosCatalog {
    public record Entry(String code, String name, String desc, String category, int price, boolean enabled,
                        boolean custom, boolean all, int cooldown) { }

    public record Snapshot(String currency, boolean configured, List<Entry> entries) { }

    private record Def(String code, String name, String category, int price, String desc) { }

    private static final List<Def> DEFS = List.of(
        new Def("heal", "Исцеление", "help", 49, "Полностью восстанавливает здоровье и тушит огонь"),
        new Def("food", "Накормить", "help", 29, "Заполняет шкалу голода и насыщения"),
        new Def("speed", "Скорость", "help", 25, "Ускорение"),
        new Def("buff", "Мощь", "help", 69, "Сила и сопротивление"),
        new Def("gift", "Подарок", "help", 39, "Случайные полезные предметы"),
        new Def("diamond", "Алмазы", "help", 59, "Алмазы в инвентарь"),
        new Def("wolf", "Пёс-защитник", "help", 79, "Приручённые волки с ником зрителя"),
        new Def("golem", "Железный голем", "help", 149, "Голем-охранник рядом с игроком"),
        new Def("blind", "Слепота", "prank", 35, "Слепота"),
        new Def("drunk", "Головокружение", "prank", 30, "Тошнота"),
        new Def("darkness", "Темнота", "prank", 45, "Пульсирующая тьма"),
        new Def("freeze", "Заморозка", "prank", 55, "Почти не может двигаться"),
        new Def("launch", "В небо!", "prank", 40, "Подбрасывает игрока, плавное падение"),
        new Def("drop", "Выронить", "prank", 75, "Предмет из руки падает на землю"),
        new Def("hotbar", "Перемешать", "prank", 89, "Перемешивает слоты хотбара"),
        new Def("pig", "Свинка", "mobs", 15, "Свиньи с ником зрителя"),
        new Def("zombie", "Зомби", "mobs", 20, "Зомби с ником зрителя"),
        new Def("skeleton", "Скелет", "mobs", 50, "Скелеты-лучники с ником зрителя"),
        new Def("creeper", "Крипер", "mobs", 60, "Криперы рядом"),
        new Def("chickenrain", "Куриный дождь", "chaos", 70, "Курицы падают с неба"),
        new Def("lightning", "Молния", "chaos", 80, "Безопасные молнии рядом с игроком"),
        new Def("faketnt", "Фейковый TNT", "chaos", 85, "Шипит и «взрывается» без разрушений"),
        new Def("night", "Ночь", "chaos", 65, "Мгновенно наступает ночь"),
        new Def("storm", "Гроза", "chaos", 99, "Гроза"),
        new Def("random", "Случайный ивент", "chaos", 100, "Любой включённый ивент наугад"));

    /** Эти события по умолчанию срабатывают у всех стримеров (эффекты на игрока), остальные — у получателя доната. */
    private static final Set<String> ALL_BY_DEFAULT = Set.of("heal", "food", "speed", "buff", "gift", "diamond",
        "blind", "drunk", "darkness", "freeze", "launch", "drop", "hotbar");

    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private ChaosCatalog() { }

    /** Общие настройки из мира (их пишет приложение в base64url). null — если их ещё нет или они повреждены. */
    static JsonObject config(MinecraftServer server) {
        String encoded = ChaosState.get(server).config();
        if (encoded.isEmpty()) return null;
        try {
            JsonElement parsed = JsonParser.parseString(new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8));
            return parsed.isJsonObject() ? parsed.getAsJsonObject() : null;
        } catch (RuntimeException error) {
            return null;
        }
    }

    public static Snapshot snapshot(MinecraftServer server) {
        JsonObject config = config(server);
        JsonObject events = object(config, "events");
        JsonObject customs = object(config, "customEvents");
        List<Entry> entries = new ArrayList<>();
        for (Def def : DEFS) {
            JsonObject event = object(events, def.code());
            entries.add(new Entry(def.code(), text(event, "name", def.name(), 48), text(event, "desc", def.desc(), 160), def.category(),
                integer(event, "price", def.price()), bool(event, "enabled", true), false,
                allPlayers(event, ALL_BY_DEFAULT.contains(def.code())), integer(event, "cooldown", 0)));
        }
        if (customs != null) {
            for (String code : customs.keySet()) {
                JsonObject custom = object(customs, code);
                if (custom == null || !code.matches("c_[0-9a-f]{8}")) continue;
                JsonObject event = object(events, code);
                entries.add(new Entry(code, text(custom, "name", "Свой ивент", 48), text(custom, "desc", "", 160), "custom",
                    integer(event, "price", 100), bool(event, "enabled", true), true, allPlayers(custom, false), integer(event, "cooldown", 0)));
            }
        }
        String currency = config != null && config.has("currency") ? config.get("currency").getAsString() : "RUB";
        return new Snapshot(currency, config != null, List.copyOf(entries));
    }

    /** Параметры силы и длительности события из настроек приложения (0 — значение мода по умолчанию). */
    public static ChaosEffects.Params params(MinecraftServer server, String code) {
        JsonObject event = object(object(config(server), "events"), code);
        return new ChaosEffects.Params(integer(event, "count", 0), integer(event, "seconds", 0), integer(event, "level", 0));
    }

    /** Команды своего события, или пустой список. */
    public static List<String> commands(MinecraftServer server, String code) {
        // Свой ивент - его команды; встроенный - изменённый в приложении скрипт (если не меняли - пусто, действие мода).
        return lines(holder(server, code), "commands");
    }

    /** Команды для первого доната в этом мире, или пустой список (тогда ивент всегда выполняет обычные). */
    public static List<String> firstCommands(MinecraftServer server, String code) {
        return lines(holder(server, code), "firstCommands");
    }

    /** Скрипт встроенного ивента по умолчанию - как в приложении. */
    public static List<String> defaultScript(String code) {
        if (!ChaosEffects.EFFECTS.containsKey(code)) return List.of();
        return List.of("baranuschaos run " + code + (ALL_BY_DEFAULT.contains(code) ? " {player@a}" : " {player}") + " {donor}");
    }

    private static JsonObject holder(MinecraftServer server, String code) {
        JsonObject config = config(server);
        JsonObject custom = object(object(config, "customEvents"), code);
        return custom != null ? custom : object(object(config, "events"), code);
    }

    private static List<String> lines(JsonObject holder, String key) {
        List<String> commands = new ArrayList<>();
        if (holder != null && holder.get(key) instanceof JsonArray array) {
            for (JsonElement element : array) if (element.isJsonPrimitive() && commands.size() < 10) commands.add(element.getAsString());
        }
        return commands;
    }

    /**
     * Включить или выключить событие прямо из игры. Настройки в мире получают новую ревизию,
     * и оба приложения подтягивают изменение сами. false — если настроек от приложения ещё нет.
     */
    public static boolean toggle(MinecraftServer server, String code) {
        JsonObject config = config(server);
        JsonObject events = object(config, "events");
        if (events == null) return false;
        boolean known = DEFS.stream().anyMatch(def -> def.code().equals(code)) || object(object(config, "customEvents"), code) != null;
        if (!known) return false;
        JsonObject event = object(events, code);
        if (event == null) {
            int price = DEFS.stream().filter(def -> def.code().equals(code)).mapToInt(Def::price).findFirst().orElse(100);
            event = new JsonObject();
            event.addProperty("price", price);
            events.add(code, event);
        }
        event.addProperty("enabled", !bool(event, "enabled", true));
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(GSON.toJson(config).getBytes(StandardCharsets.UTF_8));
        ChaosState.get(server).replaceConfig(encoded);
        return true;
    }

    /** Случайное включённое встроенное событие — для проверки «Случайного события». */
    public static String randomEnabled(MinecraftServer server, java.util.Random random) {
        List<String> codes = snapshot(server).entries().stream()
            .filter(entry -> entry.enabled() && !entry.custom() && ChaosEffects.EFFECTS.containsKey(entry.code()))
            .map(Entry::code).toList();
        return codes.isEmpty() ? null : codes.get(random.nextInt(codes.size()));
    }

    private static JsonObject object(JsonObject parent, String key) {
        return parent != null && parent.get(key) instanceof JsonObject child ? child : null;
    }

    private static String text(JsonObject object, String key, String fallback, int max) {
        try {
            if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return fallback;
            String value = object.get(key).getAsString().replace("§", "").trim();
            if (value.isEmpty()) return fallback;
            return value.length() > max ? value.substring(0, max) : value;
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    private static int integer(JsonObject object, String key, int fallback) {
        try {
            return object != null && object.has(key) ? object.get(key).getAsInt() : fallback;
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    private static boolean bool(JsonObject object, String key, boolean fallback) {
        try {
            return object != null && object.has(key) ? object.get(key).getAsBoolean() : fallback;
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    /** «Всем игрокам» - если в командах ивента есть {player@a} (без своего скрипта - как у ивента по умолчанию). */
    private static boolean allPlayers(JsonObject holder, boolean fallback) {
        List<String> commands = lines(holder, "commands");
        commands.addAll(lines(holder, "firstCommands"));
        if (commands.isEmpty()) return fallback;
        return commands.stream().anyMatch(line -> line.contains("{player@a}"));
    }
}
