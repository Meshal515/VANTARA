// The bundled MPV build identifies WARP via this renderer warning. Apply the
// official fast rendering profile only there; software video decoding alone
// does not imply a software renderer and must not lower a real GPU's quality.
export const softwareRenderPolicyLua = `
local optimized = false
mp.enable_messages("warn")
mp.register_event("log-message", function(event)
    if optimized then return end
    if event.prefix ~= "vo/gpu-next/d3d11" and event.prefix ~= "vo/gpu/d3d11" then return end
    if not event.text or not event.text:find("Using a software adapter", 1, true) then return end
    local result, err = mp.command_native({"apply-profile", "fast"})
    if result == nil then
        mp.msg.error("VANTARA software rendering profile failed: " .. tostring(err))
        return
    end
    optimized = true
    mp.commandv("script-message", "vantara-software-render", "fast")
end)
`;
