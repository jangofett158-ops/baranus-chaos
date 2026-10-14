package site.baranus.chaos;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/** Единственное состояние мода в мире — пауза хаоса. Цены и настройки живут в приложении. */
public final class ChaosState extends SavedData {
    private boolean paused;

    public static ChaosState get(MinecraftServer server) {
        return server.overworld().getDataStorage().computeIfAbsent(ChaosState::load, ChaosState::new, "baranuschaos_state");
    }

    private static ChaosState load(CompoundTag tag) {
        ChaosState state = new ChaosState();
        state.paused = tag.getBoolean("Paused");
        return state;
    }

    @Override
    public CompoundTag save(CompoundTag tag) {
        tag.putBoolean("Paused", paused);
        return tag;
    }

    public boolean paused() { return paused; }

    public void setPaused(boolean value) {
        paused = value;
        setDirty();
    }
}
