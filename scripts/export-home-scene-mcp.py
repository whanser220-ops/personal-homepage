"""Build and export via the installed Blender MCP server (Blender port 9876)."""
import asyncio
import json
import struct
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'scripts/build-home-scene.py'
OUTPUT = ROOT / 'public/assets/home-scene/afternoon-room.glb'


def validate_export():
    raw = OUTPUT.read_bytes()
    length, kind = struct.unpack_from('<II', raw, 12)
    if kind != 0x4E4F534A:
        raise RuntimeError('GLB JSON chunk missing')
    document = json.loads(raw[20:20 + length])
    required = {'Character illustration', 'Painted brick', 'Paper drawings', 'Whitewashed wood'}
    textured = {m['name'] for m in document['materials'] if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})}
    if required - textured:
        raise RuntimeError(f'Missing exported textures: {required - textured}')
    if not any(n.get('name', '').startswith('Tank water surface') for n in document['nodes']):
        raise RuntimeError('Tank surface was not exported')
    if any('citrus' in n.get('name', '').lower() or 'fruit' in n.get('name', '').lower() for n in document['nodes']):
        raise RuntimeError('Removed fruit geometry is still present')
    if not any(n.get('name', '').startswith('Music radio body') for n in document['nodes']):
        raise RuntimeError('Tabletop music player was not exported')
    for part in ['IcedCoffee glass shell','IcedCoffee liquid volume','IcedCoffee ice 00']:
        if not any(n.get('name','').startswith(part) for n in document['nodes']):
            raise RuntimeError('Missing iced coffee part: '+part)
    print(f'Validated {len(document["meshes"])} meshes and {len(document["images"])} embedded textures')


async def main():
    code = f'__file__ = {str(SOURCE)!r}\n' + SOURCE.read_text(encoding='utf-8-sig')
    server = StdioServerParameters(command='uvx', args=['mcp-for-blender'])
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool('execute_blender_code', {
                'code': code,
                'user_prompt': 'Build the cafe with its empty inset water basin and export the textured GLB for Three.js.',
            })
            message = '\n'.join(p.text for p in result.content if p.type == 'text')
            if result.isError or 'Error executing' in message or 'has no size' in message:
                raise RuntimeError(message)
            print(message)
            validate_export()
            print(f'Exported {OUTPUT} ({OUTPUT.stat().st_size} bytes)')


if __name__ == '__main__':
    asyncio.run(main())

