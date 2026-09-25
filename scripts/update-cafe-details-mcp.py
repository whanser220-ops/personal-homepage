"""Incremental Blender MCP update; does not rebuild the existing room or water."""
import asyncio
import runpy
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT=Path(__file__).resolve().parents[1]
async def main():
    script=ROOT/'scripts/detail-cafe-scene.py'
    code=f'__file__={str(script)!r}\n'+script.read_text(encoding='utf-8-sig')
    code+='''
# Refresh every used file texture, including the original transparent character.
fresh_images={}
for mat in bpy.data.materials:
    if not mat.use_nodes:continue
    for node in mat.node_tree.nodes:
        if node.type!='TEX_IMAGE' or not node.image:continue
        filename=Path(node.image.filepath).name
        candidate=TEXTURES/filename
        if not candidate.is_file():continue
        if filename not in fresh_images:fresh_images[filename]=bpy.data.images.load(str(candidate),check_existing=False)
        image=fresh_images[filename]
        if image.size[0]==0:raise RuntimeError('Missing texture '+filename)
        node.image=image
        image.filepath='//textures/'+filename
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/home-scene/afternoon-room.blend'),relative_remap=False)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/assets/home-scene/afternoon-room.glb'),export_format='GLB',export_image_format='WEBP',export_image_quality=90,export_apply=True)
'''
    async with stdio_client(StdioServerParameters(command='uvx',args=['mcp-for-blender'])) as (r,w):
        async with ClientSession(r,w) as session:
            await session.initialize()
            result=await session.call_tool('execute_blender_code',{'code':code,'user_prompt':'Preserve the original paper, wall and counter textures and place the music player on the right-hand dry countertop.'})
            message='\n'.join(p.text for p in result.content if p.type=='text')
            if result.isError or 'Error executing' in message:raise RuntimeError(message)
            print(message)
    runpy.run_path(str(ROOT/'scripts/export-home-scene-mcp.py'))['validate_export']()

asyncio.run(main())
