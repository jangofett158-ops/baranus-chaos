package site.baranus.chaos.client;

import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.model.ZombieModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;
import site.baranus.chaos.BaranusChaosMod;
import site.baranus.chaos.entity.GiantZombie;

/** Модель зомби ×4.5 со своей текстурой (можно заменить ресурс-паком). */
public final class GiantZombieRenderer extends MobRenderer<GiantZombie, ZombieModel<GiantZombie>> {
    private static final ResourceLocation TEXTURE =
        new ResourceLocation(BaranusChaosMod.MOD_ID, "textures/entity/giant_zombie.png");

    public GiantZombieRenderer(EntityRendererProvider.Context context) {
        super(context, new ZombieModel<>(context.bakeLayer(ModelLayers.ZOMBIE)), 1.55F);
    }

    @Override
    public ResourceLocation getTextureLocation(GiantZombie giant) { return TEXTURE; }

    @Override
    protected void scale(GiantZombie giant, PoseStack stack, float partialTick) {
        stack.scale(4.5F, 4.5F, 4.5F);
    }
}
