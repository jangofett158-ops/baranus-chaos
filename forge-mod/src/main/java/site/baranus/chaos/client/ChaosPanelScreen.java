package site.baranus.chaos.client;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;
import site.baranus.chaos.ChaosNetwork;

/** Панель на клавишу K (только OP): пауза хаоса, проверка событий на себе, уборка мобов. */
public final class ChaosPanelScreen extends Screen {
    private static final int COLUMNS = 3;
    private static final int ROW = 24;
    private ChaosNetwork.StatePacket state;
    private int page;
    private int rows = 6;
    private int left, top, panelWidth, panelHeight;

    public ChaosPanelScreen() { super(Component.literal("Baranus Chaos")); }

    public void apply(ChaosNetwork.StatePacket snapshot) {
        state = snapshot;
        rebuild();
    }

    @Override
    protected void init() { rebuild(); }

    private int pages() {
        return state == null ? 1 : Math.max(1, (state.items().size() + COLUMNS * rows - 1) / (COLUMNS * rows));
    }

    private void rebuild() {
        clearWidgets();
        panelWidth = Math.min(480, width - 16);
        rows = Math.max(2, Math.min(9, (height - 120) / ROW));
        panelHeight = 96 + rows * ROW;
        left = (width - panelWidth) / 2;
        top = Math.max(4, (height - panelHeight) / 2);
        page = Math.min(page, pages() - 1);
        addRenderableWidget(Button.builder(Component.literal("✕"), button -> onClose()).bounds(left + panelWidth - 28, top + 8, 20, 20).build());
        if (state == null) {
            addRenderableWidget(Button.builder(Component.literal("Обновить"), button -> ChaosClient.send("baranuschaos panel"))
                .bounds(left + 12, top + 64, 100, 20).build());
            return;
        }
        addRenderableWidget(Button.builder(Component.literal(state.paused() ? "▶ Включить хаос" : "⏸ Пауза хаоса"),
            button -> ChaosClient.send(state.paused() ? "baranuschaos resume" : "baranuschaos pause"))
            .bounds(left + 12, top + 34, 140, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Убрать мобов"), button -> ChaosClient.send("baranuschaos cleanup @s"))
            .bounds(left + 158, top + 34, 110, 20).build());

        int columnWidth = (panelWidth - 24 - (COLUMNS - 1) * 6) / COLUMNS;
        int start = page * COLUMNS * rows;
        for (int i = 0; i < COLUMNS * rows && start + i < state.items().size(); i++) {
            ChaosNetwork.StatePacket.Item item = state.items().get(start + i);
            int x = left + 12 + (i % COLUMNS) * (columnWidth + 6);
            int y = top + 66 + (i / COLUMNS) * ROW;
            Component label = Component.literal(item.label()).withStyle(Style.EMPTY.withColor(TextColor.fromRgb(item.color())));
            addRenderableWidget(Button.builder(label, button -> ChaosClient.send("baranuschaos test " + item.code() + " @s"))
                .bounds(x, y, columnWidth, 20).build());
        }
        if (pages() > 1) {
            int y = top + panelHeight - 26;
            addRenderableWidget(Button.builder(Component.literal("<"), button -> { page = Math.max(0, page - 1); rebuild(); })
                .bounds(left + panelWidth - 64, y, 24, 20).build());
            addRenderableWidget(Button.builder(Component.literal(">"), button -> { page = Math.min(pages() - 1, page + 1); rebuild(); })
                .bounds(left + panelWidth - 36, y, 24, 20).build());
        }
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        graphics.fill(0, 0, width, height, 0xB0000000);
        graphics.fill(left, top, left + panelWidth, top + panelHeight, 0xF0140E10);
        graphics.fill(left, top, left + panelWidth, top + 3, 0xFFE8263A);
        graphics.drawString(font, "BARANUS CHAOS", left + 12, top + 12, 0xFFFF6B76, false);
        if (state == null) {
            graphics.drawString(font, "Ждём данные сервера… Нужны права OP.", left + 12, top + 40, 0xFFC8C0DA, false);
        } else {
            String status = state.paused() ? "На паузе — донаты не запускают события" : "Активен — донаты запускают события";
            graphics.drawString(font, status, left + 112, top + 12, state.paused() ? 0xFFFFB547 : 0xFF34E29A, false);
            graphics.drawString(font, "Кнопка события — проверить на себе", left + 12, top + panelHeight - 20, 0xFF8A82A0, false);
            if (pages() > 1)
                graphics.drawString(font, (page + 1) + "/" + pages(), left + panelWidth - 92, top + panelHeight - 20, 0xFFC8C0DA, false);
        }
        super.render(graphics, mouseX, mouseY, partialTick);
    }

    @Override
    public boolean isPauseScreen() { return false; }
}
