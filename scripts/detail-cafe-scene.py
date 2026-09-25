"""Preserve the original cafe textures and model its tabletop radio via MCP."""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
TEXTURES = ROOT / 'art/home-scene/textures'
bpy.context.preferences.edit.use_global_undo = False

def textured(name, filename, color=(1,1,1)):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color,1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color,1)
    bsdf.inputs['Roughness'].default_value = .8
    if filename:
        tex = next((n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE'), None)
        if tex is None: tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        image = bpy.data.images.load(str(TEXTURES / filename), check_existing=True)
        tex.image = image
        mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    else:
        for link in list(bsdf.inputs['Base Color'].links):mat.node_tree.links.remove(link)
        for node in list(mat.node_tree.nodes):
            if node.type=='TEX_IMAGE':mat.node_tree.nodes.remove(node)
    return mat

paper = textured('Paper drawings','note-atlas.png')
brick = textured('Painted brick','brick-watercolor.png')
wood = textured('Whitewashed wood','counter-whitewash.png')
stone = textured('Inset pale limestone',None,(.82,.85,.81))
cloth = textured('Music woven grille',None,(.38,.48,.48))
body = textured('Music blue enamel',None,(.25,.40,.48))
rim = textured('Music brushed silver',None,(.72,.79,.77))
dark = textured('Music charcoal',None,(.045,.075,.085))
screen = textured('Music display',None,(.12,.25,.27))
mark = textured('Music dial marks',None,(.77,.88,.84))

# Reproduce the original builder's seeded postcard selection, including gaps.
# This also restores previously merged paper meshes without rebuilding the room.
note_random=random.Random(29)
original_notes=[]
for row in range(7):
    for col in range(21):
        if note_random.random()<.10:continue
        x=-13.2+col*1.28+note_random.uniform(-.3,.3)
        z=4.4+row*1.34+note_random.uniform(-.3,.3)
        note_random.uniform(.87,1.5);note_random.uniform(1.0,1.65)
        note_random.uniform(.03,.18);note_random.uniform(-.14,.14)
        original_notes.append((x,z,note_random.randrange(16)))

def original_uv(obj, kind):
    data=obj.data
    layer=data.uv_layers.active or data.uv_layers.new(name='UVMap')
    for face in data.polygons:
        for li in face.loop_indices:
            p=obj.matrix_world @ data.vertices[data.loops[li].vertex_index].co
            if kind=='brick':u,v=(p.x+16)/32*3.5,(p.z+1.7)/16*1.6
            else:u,v=p.x/6,(p.z+.6)/4
            layer.data[li].uv=(u,v)

for obj in list(bpy.context.scene.objects):
    if obj.name.startswith('Music '): bpy.data.objects.remove(obj,do_unlink=True)
    elif obj.type=='MESH':
        mats=list(obj.data.materials)
        # Portrait framing now includes the right-hand radio. Extend only the
        # room boundaries so the wider view never reveals the clear background.
        if obj.name.startswith(('Counter left cabinet','Counter right cabinet','Counter beneath basin','Whitewashed counter')):
            for vertex in obj.data.vertices:
                if vertex.co.z < -.59:vertex.co.z=-4.5
        if brick in mats:
            for vertex in obj.data.vertices:
                if vertex.co.z > 14:vertex.co.z=17
        if paper in mats:
            # Connected components retain an entire paper's front/back/edge UV island.
            data=obj.data
            neighbors=[[] for _ in data.vertices]
            for edge in data.edges:
                a,b=edge.vertices;neighbors[a].append(b);neighbors[b].append(a)
            remaining=set(range(len(data.vertices)));components=[]
            while remaining:
                first=min(remaining);remaining.remove(first);stack=[first];group={first}
                while stack:
                    for index in neighbors[stack.pop()]:
                        if index in remaining:remaining.remove(index);group.add(index);stack.append(index)
                center=sum((obj.matrix_world @ data.vertices[i].co for i in group),Vector())/len(group)
                components.append((center,group))
            uv=data.uv_layers.active
            for center,group in components:
                loops=[li for f in data.polygons if f.vertices[0] in group for li in f.loop_indices]
                xmin=min(uv.data[i].uv.x for i in loops);xmax=max(uv.data[i].uv.x for i in loops)
                ymin=min(uv.data[i].uv.y for i in loops);ymax=max(uv.data[i].uv.y for i in loops)
                tile=min(original_notes,key=lambda n:(n[0]-center.x)**2+(n[1]-center.z)**2)[2]
                for li in loops:
                    u,v=uv.data[li].uv
                    uv.data[li].uv=((tile%4)/4+.005+(u-xmin)/max(.0001,xmax-xmin)*.240,
                                   1-(tile//4+1)/4+.005+(v-ymin)/max(.0001,ymax-ymin)*.240)
        elif brick in mats:original_uv(obj,'brick')
        elif wood in mats:original_uv(obj,'wood')
        elif stone in mats:
            # Restore the original narrow rear lip; the radio sits on the right slab.
            if obj.name=='Counter rear lip':
                for v in obj.data.vertices:
                    if v.co.y>-.8:v.co.y=-.75

def mesh(name,vertices,faces,mat,uv=None):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);data.materials.append(mat)
    if uv:
        layer=data.uv_layers.new(name='UVMap')
        for poly in data.polygons:
            for li in poly.loop_indices:layer.data[li].uv=uv[data.loops[li].vertex_index]
    return obj

def box(name,lo,hi,mat,bevel=0):
    x,y,z=lo;X,Y,Z=hi
    obj=mesh(name,[(x,y,z),(X,y,z),(X,Y,z),(x,Y,z),(x,y,Z),(X,y,Z),(X,Y,Z),(x,Y,Z)],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],mat)
    if bevel:
        mod=obj.modifiers.new('Soft machined edges','BEVEL');mod.width=bevel;mod.segments=3
        obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return obj

box('Music radio body',(-2.25,-.99,4.64),(-.35,-.32,5.64),body,.08)
for x in [-2.0,-.65]:box('Music rubber foot',(x-.10,-.82,4.55),(x+.10,-.48,4.66),dark,.025)
box('Music grille bezel',(-2.14,-1.005,4.78),(-1.28,-.985,5.50),rim,.04)
mesh('Music fabric speaker',[(-2.09,-1.016,4.83),(-1.33,-1.016,4.83),(-1.33,-1.016,5.45),(-2.09,-1.016,5.45)],[(0,1,2,3)],cloth,[(.506,.006),(.994,.006),(.994,.494),(.506,.494)])
box('Music screen surround',(-1.17,-1.011,5.08),(-.48,-.99,5.50),dark,.025)
box('Music display glass',(-1.13,-1.018,5.12),(-.52,-1.011,5.46),screen,.012)
# Cylinders face the viewer in Blender -Y; radial dial and metallic cap.
def dial(name,x,z,r,depth,mat):
    n=40;verts=[]
    for y in [-1.015,-1.015-depth]:verts.extend([(x+r*math.cos(i*2*math.pi/n),y,z+r*math.sin(i*2*math.pi/n)) for i in range(n)])
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,verts,faces,mat)
dial('Music tuning rim',-.68,4.87,.14,.09,dark)
dial('Music tuning knob',-.68,4.87,.11,.10,rim)
box('Music knob indicator',(-.686,-1.123,4.90),(-.673,-1.118,4.95),mark)
for x in [-1.10,-.98]:box('Music small key',(x-.035,-1.04,4.82),(x+.035,-1.013,4.91),rim,.014)
box('Music handle left',(-1.94,-.58,5.60),(-1.86,-.46,5.87),rim,.03)
box('Music handle right',(-.76,-.58,5.60),(-.68,-.46,5.87),rim,.03)
box('Music carry handle',(-1.94,-.58,5.82),(-.68,-.46,5.91),dark,.04)
for obj in bpy.context.scene.objects:
    if obj.name.startswith('Music '):
        obj.location.x += 5.15
        obj.location.y -= 2.30
print('CAFE_DETAILS_READY',len(bpy.context.scene.objects),flush=True)
exec(compile((ROOT/'scripts/build-iced-coffee.py').read_text(encoding='utf-8-sig'),'build-iced-coffee.py','exec'))
