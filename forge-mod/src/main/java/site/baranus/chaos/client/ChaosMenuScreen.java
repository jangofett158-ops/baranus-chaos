package site.baranus.chaos.client;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.minecraft.ChatFormatting;
import net.minecraft.Util;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Mth;
import site.baranus.chaos.ChaosNetwork;
import site.baranus.chaos.ChaosNetwork.StatePacket.Item;

/**
 * Меню событий Baranus Chaos (клавиша K): все события с ценами из приложения, поиск и категории.
 * Хозяин мира и OP проверяют события на себе и включают/выключают их — изменения уходят в оба приложения.
 */
public final class ChaosMenuScreen extends Screen {
    // Палитра в тон приложению.
    private static final int ACCENT = 0xFFE8263A;
    private static final int ACCENT_DARK = 0xFF8E1424;
    private static final int PANEL = 0xF2120C0E;
    private static final int CARD = 0xFF1B1315;
    private static final int CARD_HOVER = 0xFF261A1D;
    private static final int LINE = 0xFF3A2327;
    private static final int TEXT = 0xFFF4ECEE;
    private static final int MUTED = 0xFF9C8B90;
    private static final int GREEN = 0xFF34E29A;
    private static final int AMBER = 0xFFFFB547;

    private record Tab(String id, String name, int color) { }

    /** Вкладка на экране: подпись и место. */
    private record TabSlot(Tab tab, String label, int x, int w) { }

    private static final List<Tab> TABS = List.of(
        new Tab("all", "Все", ACCENT), new Tab("help", "Помощь", 0xFF34E29A), new Tab("prank", "Пакости", 0xFFFFB547),
        new Tab("mobs", "Мобы", 0xFFFF5468), new Tab("chaos", "Хаос", 0xFFB38CFF), new Tab("custom", "Свои", 0xFF4FB6FF));

    private static final Map<String, String> SYMBOLS = Map.of("RUB", "₽", "USD", "$", "EUR", "€", "UAH", "₴", "KZT", "₸",
        "BYN", "Br", "PLN", "zł", "TRY", "₺", "BRL", "R$");

    private static final int CARD_H = 42, GAP = 6, HEADER = 46, TOOLBAR = 22;

    private ChaosNetwork.StatePacket state;
    private final long openedAt = Util.getMillis();
    private String tab = "all";
    private String query = "";
    private EditBox search;
    private double scroll, scrollTarget;
    private String toast = "";
    private long toastAt;

    // Геометрия, пересчитывается в init().
    private int left, top, panelW, panelH, gridX, gridY, gridW, gridH, columns, cardW, searchW;

    public ChaosMenuScreen() { super(Component.literal("Baranus Chaos")); }

    public void apply(ChaosNetwork.StatePacket snapshot) {
        state = snapshot;
        clampScroll();
    }

    @Override
    protected void init() {
        panelW = Math.min(620, width - 20);
        panelH = Math.min(400, height - 20);
        left = (width - panelW) / 2;
        top = (height - panelH) / 2;
        gridX = left + 12;
        gridY = top + HEADER + TOOLBAR + 12;
        gridW = panelW - 24 - 6;
        gridH = panelH - HEADER - TOOLBAR - 12 - 10;
        columns = panelW >= 540 ? 3 : 2;
        cardW = (gridW - (columns - 1) * GAP) / columns;

        String previous = search == null ? "" : search.getValue();
        searchW = Mth.clamp(panelW * 28 / 100, 84, 142);
        search = new EditBox(font, left + 14, top + HEADER + 7, searchW - 10, 12, Component.literal("Поиск"));
        search.setBordered(false);
        search.setMaxLength(32);
        search.setTextColor(TEXT);
        search.setHint(Component.literal("Поиск ивента…").withStyle(ChatFormatting.DARK_GRAY));
        search.setValue(previous);
        search.setResponder(value -> { query = value.toLowerCase(Locale.ROOT).trim(); scrollTarget = 0; });
        addRenderableWidget(search);
        clampScroll();
    }

    // ---------- Данные ----------

    private List<Item> visible() {
        List<Item> result = new ArrayList<>();
        if (state == null) return result;
        for (Item item : state.items()) {
            if (!"all".equals(tab) && !tab.equals(item.category())) continue;
            if (!query.isEmpty() && !item.name().toLowerCase(Locale.ROOT).contains(query)
                && !item.desc().toLowerCase(Locale.ROOT).contains(query)) continue;
            result.add(item);
        }
        return result;
    }

    private int count(String category) {
        if (state == null) return 0;
        return (int) state.items().stream().filter(item -> "all".equals(category) || category.equals(item.category())).count();
    }

    private String price(Item item) {
        String currency = state == null ? "RUB" : state.currency();
        String symbol = SYMBOLS.getOrDefault(currency, currency);
        return symbol.equals("$") || symbol.equals("€") || symbol.equals("R$") ? symbol + item.price() : item.price() + " " + symbol;
    }

    private static int colorOf(String category) {
        for (Tab tab : TABS) if (tab.id().equals(category)) return tab.color();
        return ACCENT;
    }

    private int contentHeight() {
        int rows = (visible().size() + columns - 1) / columns;
        return rows == 0 ? 0 : rows * (CARD_H + GAP) - GAP;
    }

    private void clampScroll() {
        double max = Math.max(0, contentHeight() - gridH);
        scrollTarget = Mth.clamp(scrollTarget, 0, max);
        scroll = Mth.clamp(scroll, 0, max);
    }

    // ---------- Отрисовка ----------

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        float open = Mth.clamp((Util.getMillis() - openedAt) / 220f, 0f, 1f);
        float ease = 1f - (float) Math.pow(1f - open, 3);
        scroll += (scrollTarget - scroll) * 0.35;

        // Затемнение и красное свечение сверху.
        int dim = (int) (0xC0 * ease) << 24;
        g.fill(0, 0, width, height, dim);
        g.fillGradient(0, 0, width, height / 3, ((int) (0x40 * ease) << 24) | 0x8E1424, 0x00000000);

        g.pose().pushPose();
        float scale = 0.94f + 0.06f * ease;
        g.pose().translate(width / 2f, height / 2f + (1f - ease) * 12f, 0);
        g.pose().scale(scale, scale, 1f);
        g.pose().translate(-width / 2f, -height / 2f, 0);

        drawPanel(g);
        drawHeader(g, mouseX, mouseY);
        drawToolbar(g, mouseX, mouseY);
        Item hovered = drawGrid(g, mouseX, mouseY);
        super.render(g, mouseX, mouseY, partialTick);
        drawToast(g);
        g.pose().popPose();

        if (hovered != null && !overToggle(hovered, mouseX, mouseY)) drawTooltip(g, hovered, mouseX, mouseY);
    }

    private void drawPanel(GuiGraphics g) {
        // Мягкая тень, корпус со срезанными углами и красная кромка.
        g.fill(left - 3, top - 1, left + panelW + 3, top + panelH + 4, 0x40000000);
        g.fill(left + 1, top, left + panelW - 1, top + panelH, PANEL);
        g.fill(left, top + 1, left + panelW, top + panelH - 1, PANEL);
        outline(g, left, top, panelW, panelH, LINE);
        g.fillGradient(left + 1, top + 1, left + panelW - 1, top + HEADER, 0xFF2A0D13, 0xFF140C0E);
        g.fill(left + 1, top + 1, left + panelW - 1, top + 3, ACCENT);
        g.fill(left + 1, top + HEADER, left + panelW - 1, top + HEADER + 1, LINE);
    }

    private void drawHeader(GuiGraphics g, int mouseX, int mouseY) {
        g.pose().pushPose();
        g.pose().translate(left + 14, top + 11, 0);
        g.pose().scale(1.6f, 1.6f, 1f);
        g.drawString(font, "BARANUS", 0, 0, TEXT, true);
        g.drawString(font, "CHAOS", font.width("BARANUS "), 0, ACCENT, true);
        g.pose().popPose();
        g.drawString(font, "Меню ивентов", left + 14, top + 30, MUTED, false);

        // Статус хаоса - кнопка: щелчок ставит паузу или включает хаос (хозяин мира и OP). Пульсирующая точка.
        if (state != null) {
            boolean paused = state.paused();
            int[] r = statusRect();
            int x = r[0], y = r[1], w = r[2];
            boolean hover = state.control() && inside(mouseX, mouseY, x, y, w, 15);
            String label = hover ? statusAction() : statusLabel();
            int color = paused ? AMBER : GREEN;
            pill(g, x, y, w, 15, (color & 0x00FFFFFF) | (hover ? 0x60000000 : 0x30000000), hover ? TEXT : color);
            float pulse = 0.55f + 0.45f * Mth.sin(Util.getMillis() / 260f);
            int dot = ((int) (255 * pulse) << 24) | (color & 0x00FFFFFF);
            g.fill(x + 6, y + 5, x + 11, y + 10, dot);
            g.drawString(font, label, x + 15, y + 4, hover ? TEXT : color, false);
            if (!state.configured())
                g.drawString(font, "Цены появятся, когда подключится приложение", left + 112, top + 30, AMBER, false);
        }
        // Кнопка закрытия.
        boolean hover = inside(mouseX, mouseY, left + panelW - 26, top + 12, 16, 16);
        pill(g, left + panelW - 26, top + 12, 16, 16, hover ? ACCENT : 0x30FFFFFF, hover ? ACCENT : LINE);
        g.drawCenteredString(font, "✕", left + panelW - 18, top + 16, TEXT);
    }

    private void drawToolbar(GuiGraphics g, int mouseX, int mouseY) {
        int y = top + HEADER + 4;
        // Поле поиска.
        pill(g, left + 10, y, searchW, 17, 0xFF0D0809, search != null && search.isFocused() ? ACCENT : LINE);
        // Вкладки категорий.
        for (TabSlot slot : tabSlots()) {
            boolean active = slot.tab().id().equals(tab);
            boolean hover = inside(mouseX, mouseY, slot.x(), y, slot.w(), 17);
            int color = slot.tab().color();
            pill(g, slot.x(), y, slot.w(), 17, active ? color : hover ? 0x30FFFFFF : 0x18FFFFFF, active ? color : LINE);
            g.drawString(font, slot.label(), slot.x() + (slot.w() - font.width(slot.label())) / 2, y + 5, active ? 0xFF140C0E : TEXT, false);
        }
    }

    /**
     * Вкладки подстраиваются под ширину окна: со счётчиками у всех, со счётчиком только у выбранной,
     * без счётчиков; если и так не влезает — лишние справа не показываются.
     */
    private List<TabSlot> tabSlots() {
        List<Tab> tabs = TABS.stream().filter(t -> "all".equals(t.id()) || count(t.id()) > 0).toList();
        int start = left + 10 + searchW + 8, end = left + panelW - 10;
        List<TabSlot> slots = new ArrayList<>();
        for (int mode = 0; mode < 3; mode++) {
            slots.clear();
            int x = start;
            boolean fits = true;
            for (Tab t : tabs) {
                boolean counted = mode == 0 || (mode == 1 && t.id().equals(tab));
                String label = counted ? t.name() + " " + count(t.id()) : t.name();
                int w = font.width(label) + (mode == 2 ? 10 : 14);
                if (x + w > end) { fits = false; break; }
                slots.add(new TabSlot(t, label, x, w));
                x += w + (mode == 2 ? 3 : 5);
            }
            if (fits) break;
        }
        return slots;
    }

    private Item drawGrid(GuiGraphics g, int mouseX, int mouseY) {
        if (state == null) {
            g.drawCenteredString(font, "Загружаем ивенты…", left + panelW / 2, gridY + gridH / 2 - 4, MUTED);
            return null;
        }
        List<Item> items = visible();
        if (items.isEmpty()) {
            g.drawCenteredString(font, "Ничего не найдено", left + panelW / 2, gridY + gridH / 2 - 4, MUTED);
            return null;
        }
        Item hovered = null;
        boolean inGrid = inside(mouseX, mouseY, gridX, gridY, gridW, gridH);
        g.enableScissor(gridX - 2, gridY - 2, gridX + gridW + 2, gridY + gridH + 2);
        for (int i = 0; i < items.size(); i++) {
            int x = gridX + (i % columns) * (cardW + GAP);
            int y = gridY + (i / columns) * (CARD_H + GAP) - (int) Math.round(scroll);
            if (y + CARD_H < gridY - 2 || y > gridY + gridH + 2) continue;
            Item item = items.get(i);
            boolean hover = inGrid && inside(mouseX, mouseY, x, y, cardW, CARD_H);
            if (hover) hovered = item;
            drawCard(g, item, x, y, hover, mouseX, mouseY);
        }
        g.disableScissor();

        // Полоса прокрутки.
        int content = contentHeight();
        if (content > gridH) {
            int barX = gridX + gridW + 3;
            g.fill(barX, gridY, barX + 3, gridY + gridH, 0x30FFFFFF);
            int thumb = Math.max(20, gridH * gridH / content);
            int thumbY = gridY + (int) ((gridH - thumb) * (scroll / (content - gridH)));
            g.fill(barX, thumbY, barX + 3, thumbY + thumb, ACCENT);
        }
        return hovered;
    }

    private void drawCard(GuiGraphics g, Item item, int x, int y, boolean hover, int mouseX, int mouseY) {
        int color = colorOf(item.category());
        g.fill(x, y, x + cardW, y + CARD_H, hover ? CARD_HOVER : CARD);
        outline(g, x, y, cardW, CARD_H, hover ? color : LINE);
        g.fill(x, y, x + 3, y + CARD_H, item.enabled() ? color : 0xFF4A4045);
        if (hover) g.fillGradient(x + 3, y, x + cardW, y + CARD_H, (color & 0x00FFFFFF) | 0x22000000, 0x00000000);

        // Цена — красная плашка справа сверху.
        String price = price(item);
        int pw = font.width(price) + 10;
        pill(g, x + cardW - pw - 6, y + 5, pw, 13, item.enabled() ? ACCENT : 0xFF4A4045, item.enabled() ? ACCENT : 0xFF4A4045);
        g.drawString(font, price, x + cardW - pw - 1, y + 8, TEXT, false);

        // Название и описание.
        int textW = cardW - pw - 22;
        String name = ellipsis(item.name(), textW);
        g.drawString(font, Component.literal(name).withStyle(ChatFormatting.BOLD), x + 9, y + 7, item.enabled() ? TEXT : MUTED, true);
        String desc = item.desc().isEmpty() ? (item.custom() ? "Свой ивент" : "") : item.desc();
        g.drawString(font, ellipsis(desc, cardW - 18), x + 9, y + 19, item.enabled() ? 0xFFB9A9AE : 0xFF6E6266, false);

        // Нижняя строка: кому срабатывает, перезарядка, подсказка проверки.
        StringBuilder meta = new StringBuilder(item.all() ? "всем стримерам" : "получателю");
        if (item.cooldown() > 0) meta.append(" · раз в ").append(item.cooldown()).append(" с");
        if (!item.enabled()) meta.append(" · выключено");
        int metaColor = item.enabled() ? 0xFF7D6B71 : 0xFF5E5357;
        if (hover && state.control() && !overToggle(item, mouseX, mouseY)) {
            g.drawString(font, "▶ Проверить на себе", x + 9, y + 30, color, false);
        } else {
            g.drawString(font, ellipsis(meta.toString(), cardW - 44), x + 9, y + 30, metaColor, false);
        }

        // Переключатель вкл/выкл.
        int tx = toggleX(x), ty = y + CARD_H - 13;
        boolean on = item.enabled();
        boolean overSwitch = hover && state.control() && overToggle(item, mouseX, mouseY);
        pill(g, tx, ty, 20, 9, on ? 0xFF1F8A5C : 0xFF3A3034, overSwitch ? TEXT : (on ? GREEN : 0xFF5E5357));
        int knob = on ? tx + 12 : tx + 1;
        g.fill(knob, ty + 1, knob + 7, ty + 8, on ? 0xFFFFFFFF : 0xFFB0A4A8);
    }

    private String statusLabel() { return state.paused() ? "ПАУЗА" : "ХАОС АКТИВЕН"; }

    private String statusAction() { return state.paused() ? "ВКЛЮЧИТЬ ХАОС" : "ПОСТАВИТЬ ПАУЗУ"; }

    /** Место кнопки статуса: ширина - по самой длинной из двух надписей, чтобы она не прыгала при наведении. */
    private int[] statusRect() {
        int w = Math.max(font.width(statusLabel()), state.control() ? font.width(statusAction()) : 0) + 22;
        return new int[] {left + panelW - 34 - w, top + 13, w};
    }

    private void drawToast(GuiGraphics g) {
        long age = Util.getMillis() - toastAt;
        if (toast.isEmpty() || age > 1800) return;
        float alpha = age < 1400 ? 1f : 1f - (age - 1400) / 400f;
        int a = Math.max(8, (int) (255 * alpha));
        int w = font.width(toast) + 20;
        int x = left + (panelW - w) / 2, y = top + panelH - 26;
        g.fill(x, y, x + w, y + 16, (Math.min(a, 0xE0) << 24) | 0x1B1315);
        outline(g, x, y, w, 16, (a << 24) | (ACCENT & 0x00FFFFFF));
        g.drawString(font, toast, x + 10, y + 4, (a << 24) | 0xF4ECEE, false);
    }

    private void drawTooltip(GuiGraphics g, Item item, int mouseX, int mouseY) {
        List<FormattedCharSequence> lines = new ArrayList<>();
        lines.add(Component.literal(item.name()).withStyle(ChatFormatting.BOLD).getVisualOrderText());
        if (!item.desc().isEmpty()) lines.addAll(font.split(Component.literal(item.desc()).withStyle(ChatFormatting.GRAY), 200));
        lines.add(Component.literal("Цена: " + price(item)).withStyle(ChatFormatting.RED).getVisualOrderText());
        lines.add(Component.literal(item.all() ? "Срабатывает у всех стримеров" : "Срабатывает у стримера, которому задонатили")
            .withStyle(ChatFormatting.DARK_GRAY).getVisualOrderText());
        if (item.cooldown() > 0)
            lines.add(Component.literal("Перезарядка: " + item.cooldown() + " с").withStyle(ChatFormatting.DARK_GRAY).getVisualOrderText());
        g.renderTooltip(font, lines, mouseX, mouseY);
    }

    // ---------- Ввод ----------

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        int mx = (int) mouseX, my = (int) mouseY;
        if (button == 0) {
            if (inside(mx, my, left + panelW - 26, top + 12, 16, 16)) { click(); onClose(); return true; }
            if (clickStatus(mx, my) || clickTab(mx, my) || clickCard(mx, my)) return true;
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    private boolean clickTab(int mx, int my) {
        int y = top + HEADER + 4;
        for (TabSlot slot : tabSlots()) {
            if (inside(mx, my, slot.x(), y, slot.w(), 17)) {
                tab = slot.tab().id();
                scrollTarget = 0;
                click();
                return true;
            }
        }
        return false;
    }

    private boolean clickStatus(int mx, int my) {
        if (state == null || !state.control()) return false;
        int[] r = statusRect();
        if (!inside(mx, my, r[0], r[1], r[2], 15)) return false;
        ChaosClient.send(state.paused() ? "baranuschaos resume" : "baranuschaos pause");
        showToast(state.paused() ? "Хаос снова активен" : "Хаос на паузе");
        click();
        return true;
    }

    private boolean clickCard(int mx, int my) {
        if (state == null || !inside(mx, my, gridX, gridY, gridW, gridH)) return false;
        List<Item> items = visible();
        for (int i = 0; i < items.size(); i++) {
            int x = gridX + (i % columns) * (cardW + GAP);
            int y = gridY + (i / columns) * (CARD_H + GAP) - (int) Math.round(scroll);
            if (!inside(mx, my, x, y, cardW, CARD_H)) continue;
            Item item = items.get(i);
            if (!state.control()) {
                showToast("Проверять ивенты может хозяин мира");
                return true;
            }
            click();
            if (inside(mx, my, toggleX(x) - 3, y + CARD_H - 16, 26, 15)) {
                if (!state.configured()) {
                    showToast("Сначала подключите приложение Baranus Chaos");
                    return true;
                }
                ChaosClient.send("baranuschaos toggle " + item.code());
                showToast((item.enabled() ? "Выключено: " : "Включено: ") + item.name());
            } else {
                ChaosClient.send("baranuschaos try " + item.code());
                showToast("Проверка: " + item.name());
            }
            return true;
        }
        return false;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double delta) {
        scrollTarget -= delta * (CARD_H + GAP) * 0.75;
        clampScroll();
        return true;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (ChaosClient.PANEL_KEY.matches(keyCode, scanCode) && (search == null || !search.isFocused())) {
            onClose();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean isPauseScreen() { return false; }

    // ---------- Мелочи ----------

    private int toggleX(int cardX) { return cardX + cardW - 28; }

    private boolean overToggle(Item item, int mouseX, int mouseY) {
        List<Item> items = visible();
        int i = items.indexOf(item);
        if (i < 0) return false;
        int x = gridX + (i % columns) * (cardW + GAP);
        int y = gridY + (i / columns) * (CARD_H + GAP) - (int) Math.round(scroll);
        return inside(mouseX, mouseY, toggleX(x) - 3, y + CARD_H - 16, 26, 15);
    }

    private void showToast(String text) {
        toast = text;
        toastAt = Util.getMillis();
    }

    private void click() {
        if (minecraft != null) minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0F));
    }

    private String ellipsis(String text, int maxWidth) {
        if (font.width(text) <= maxWidth) return text;
        return font.plainSubstrByWidth(text, Math.max(0, maxWidth - font.width("…"))) + "…";
    }

    private static boolean inside(int mx, int my, int x, int y, int w, int h) {
        return mx >= x && mx < x + w && my >= y && my < y + h;
    }

    /** Прямоугольник со срезанными углами — «скруглённая» плашка в пиксельном стиле. */
    private static void pill(GuiGraphics g, int x, int y, int w, int h, int fill, int border) {
        g.fill(x + 1, y + 1, x + w - 1, y + h - 1, fill);
        g.fill(x + 1, y, x + w - 1, y + 1, border);
        g.fill(x + 1, y + h - 1, x + w - 1, y + h, border);
        g.fill(x, y + 1, x + 1, y + h - 1, border);
        g.fill(x + w - 1, y + 1, x + w, y + h - 1, border);
    }

    private static void outline(GuiGraphics g, int x, int y, int w, int h, int color) {
        g.fill(x, y, x + w, y + 1, color);
        g.fill(x, y + h - 1, x + w, y + h, color);
        g.fill(x, y + 1, x + 1, y + h - 1, color);
        g.fill(x + w - 1, y + 1, x + w, y + h - 1, color);
    }
}
