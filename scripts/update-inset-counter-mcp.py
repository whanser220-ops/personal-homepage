"""Update just the counter in the saved Blender scene via MCP, then export."""
import asyncio
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import runpy
ROOT=Path(__file__).resolve().parents[1]
async def main():
    code=(ROOT/'scripts/build-inset-counter.py').read_text(encoding='utf-8-sig')
    detail=ROOT/'scripts/detail-cafe-scene.py'
    code+=f'\n__file__={str(detail)!r}\n'+detail.read_text(encoding='utf-8-sig')
    code+=f'\nfrom pathlib import Path\nroot=Path({str(ROOT)!r})\n'
    code+='''
texture_files={'Painted brick':'brick-watercolor.png','Paper drawings':'note-atlas.png','Whitewashed wood':'counter-whitewash.png','Character illustration':'coffee-character-v2.png'}
for material in bpy.data.materials:
    filename=next((v for k,v in texture_files.items() if material.name.startswith(k)),None)
    if not filename or not material.use_nodes:continue
    for node in material.node_tree.nodes:
        if node.type != 'TEX_IMAGE':continue
        image=bpy.data.images.load(str(root/'art/home-scene/textures'/filename),check_existing=False)
        if image.size[0] == 0:raise RuntimeError('Missing texture '+filename)
        node.image=image
        image.filepath='//textures/'+filename
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(root/'art/home-scene/afternoon-room.blend'),relative_remap=False)
bpy.ops.export_scene.gltf(filepath=str(root/'public/assets/home-scene/afternoon-room.glb'),export_format='GLB',export_image_format='WEBP',export_image_quality=90,export_apply=True)
'''
    async with stdio_client(StdioServerParameters(command='uvx',args=['mcp-for-blender'])) as (r,w):
        async with ClientSession(r,w) as s:
            await s.initialize()
            result=await s.call_tool('execute_blender_code',{'code':code,'user_prompt':'Remove the fruit aquarium, cut the tabletop and integrate an empty recessed water basin.'})
            message='\n'.join(p.text for p in result.content if p.type=='text')
            if result.isError or 'Error executing' in message:raise RuntimeError(message)
            print(message)
    runpy.run_path(str(ROOT/'scripts/export-home-scene-mcp.py'))['validate_export']()
asyncio.run(main())

