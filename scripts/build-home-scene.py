"""Reproducible illustrated cafe scene, executed inside Blender via its MCP server."""
import bpy
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/home-scene'
SOURCE = ROOT / 'art/home-scene'
SOURCE.mkdir(parents=True, exist_ok=True)
random.seed(29)
bpy.context.preferences.edit.use_global_undo = False
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for mat in list(bpy.data.materials): bpy.data.materials.remove(mat)
for img in list(bpy.data.images):
    if img.source == 'FILE' and img.users == 0: bpy.data.images.remove(img)

def material(name, color, image=None, alpha=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = .92
    if image:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(SOURCE / 'textures' / image), check_existing=False)
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            mat.surface_render_method = 'DITHERED'
            mat.use_backface_culling = False
    return mat

brick = material('Painted brick', (1,1,1), 'brick-watercolor.png')
paper = material('Paper drawings', (1,1,1), 'note-atlas.png')
plaster = material('Warm plaster', (.83,.85,.81))
wood = material('Whitewashed wood', (1,1,1), 'counter-whitewash.png')
ink = material('Pencil edges', (.16,.13,.105))
stem = material('Ivy stems', (.21,.25,.095))
leaves = [material('Ivy pigment %d'%i, c) for i,c in enumerate([(.14,.34,.25),(.24,.46,.34),(.38,.55,.37),(.12,.28,.23),(.43,.59,.36)])]
ceramic = material('Ivory pottery', (.93,.86,.69))
coffee = material('Coffee', (.10,.065,.04))
character = material('Character illustration', (1,1,1), 'coffee-character-v2.png', True)

def mesh(name, verts, faces, mat, uvs=None):
    data=bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    if uvs:
        layer=data.uv_layers.new(name='UVMap')
        for polygon in data.polygons:
            for li in polygon.loop_indices:
                layer.data[li].uv=uvs[data.loops[li].vertex_index]
    return obj

def plane(name,x,y,z,w,h,mat,uvs=None):
    return mesh(name,[(x-w/2,y,z-h/2),(x+w/2,y,z-h/2),(x+w/2,y,z+h/2),(x-w/2,y,z+h/2)],[(0,1,2,3)],mat,uvs or [(0,0),(1,0),(1,1),(0,1)])

def cube(name, loc, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.name=name;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat)
    if bevel:
        mod=o.modifiers.new('Worn edges','BEVEL');mod.width=bevel;mod.segments=2
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def line(name,pts,r,mat):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=r;data.bevel_resolution=0
    s=data.splines.new('POLY');s.points.add(len(pts)-1)
    for p,v in zip(s.points,pts):p.co=(*v,1)
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object

plane('Brick wall',0,1.30,6.3,32,16,brick,[(0,0),(3.5,0),(3.5,1.6),(0,1.6)])
# Dense, irregular overlapping postcards. Each face samples one cell of a shared atlas.
for row in range(7):
    for col in range(21):
        i=row*21+col
        if random.random()<.10:continue
        x=-13.2+col*1.28+random.uniform(-.3,.3)
        z=4.4+row*1.34+random.uniform(-.3,.3)
        w=random.uniform(.87,1.5);h=random.uniform(1.0,1.65)
        y=1.14-random.uniform(.03,.18)
        angle=random.uniform(-.14,.14)
        tile=random.randrange(16);u=(tile%4)/4;v=1-(tile//4+1)/4
        uv=[(u+.005,v+.005),(u+.245,v+.005),(u+.245,v+.245),(u+.005,v+.245)]
        points=[]
        for a,b in [(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]:
            points.append((x+a*math.cos(angle)-b*math.sin(angle),y-(.06 if b<0 else 0),z+a*math.sin(angle)+b*math.cos(angle)))
        o=mesh('Paper %03d'%i,points,[(0,1,2,3)],paper,uv)
        solid=o.modifiers.new('Paper thickness','SOLIDIFY');solid.thickness=.009
        line('Paper pencil edge',points+[points[0]],.004,ink)
        pinx=x-h*.43*math.sin(angle);pinz=z+h*.43*math.cos(angle)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.025,location=(pinx,y-.035,pinz))
        bpy.context.object.name='Tiny paper pin';bpy.context.object.data.materials.append(ink)

# Projecting plaster counter, with chips, seams, and grain on the pale wooden front.
cube('Counter body',(0,-1.9,1.5),(32,.6,4),plaster,.025)
plane('Whitewashed counter front',0,-2.215,1.5,32,4,wood,[(0,0),(5,0),(5,1),(0,1)])
cube('Counter slab',(0,-1.8,3.88),(32,1.75,.57),plaster,.035)
for x in range(-15,17,2):
    line('Plank seam',[(x,-2.23,-.5),(x+.015,-2.235,1.5),(x-.025,-2.23,3.59)],.007,ink)
for x in range(-14,17,4):
    line('Slab joint',[(x,-2.68,3.59),(x+.03,-2.683,3.87),(x,-2.66,4.15)],.009,ink)
for i in range(155):
    x=random.uniform(-15,15);z=random.choice([3.63,4.09])+random.uniform(-.05,.035)
    length=random.uniform(.025,.17)
    line('Plaster patina',[(x,-2.686,z),(x+length,-2.686,z+random.uniform(-.015,.015))],random.uniform(.002,.007),ink)

# Seated upper-body illustration is recessed behind the real counter.
plane('Character illustration',-.45,-.60,6.79,6.1,6.1,character)

# Revolved pottery with inner surfaces rather than solid cones.
def vessel(name,x,y,z,scale):
    profile=[(.18,0),(.21,.03),(.28,.32),(.31,.48),(.29,.50),(.265,.46),(.235,.12),(.16,.07)]
    n=40;verts=[]
    for r,h in profile:
        verts.extend([(x+r*scale*math.cos(i*2*math.pi/n),y+r*scale*math.sin(i*2*math.pi/n),z+h*scale) for i in range(n)])
    faces=[]
    for j in range(len(profile)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    o=mesh(name,verts,faces,ceramic)
    for p in o.data.polygons:p.use_smooth=True
    line(name+' rim',[(x+.302*scale*math.cos(i*2*math.pi/n),y+.302*scale*math.sin(i*2*math.pi/n),z+.49*scale) for i in range(n+1)],.009,ink)
    return o
vessel('Espresso',1.75,-1.70,4.19,.8)
vessel('Ceramic bowl',2.65,-1.62,4.19,1.4)
line('Espresso handle',[(1.95,-1.70,4.53),(2.09,-1.70,4.54),(2.13,-1.70,4.37),(1.96,-1.70,4.30)],.035,ceramic)
mesh('Folded linen',[(2.43,-1.5,4.65),(2.49,-1.53,5.08),(2.73,-1.52,5.11),(2.79,-1.5,4.7),(2.83,-1.47,4.98),(2.63,-1.46,5.08)],[(0,1,2,3),(3,2,5,4)],plaster)

# Five-lobed ivy leaves with raised midrib, depth, pencil edge and veins.
outline=[(0,-.64),(-.22,-.27),(-.52,-.22),(-.38,.04),(-.61,.30),(-.20,.27),(0,.57),(.20,.27),(.61,.30),(.38,.04),(.52,-.22),(.22,-.27)]
def leaf(x,y,z,size,a,index):
    ca,sa=math.cos(a),math.sin(a)
    pts=[(x+(u*ca-v*sa)*size,y,z+(u*sa+v*ca)*size) for u,v in outline]
    verts=pts+[(x,y-.055,z)]
    mesh('Ivy leaf',verts,[(i,(i+1)%12,12) for i in range(12)],leaves[index%5])
    line('Ivy pencil outline',pts+[pts[0]],.005,stem)
    line('Ivy midrib',[pts[0],verts[-1],pts[6]],.006,stem)
for branch in range(7):
    x0=.9+branch*.43
    length=[8,11,9,13,12,10,8][branch]
    pts=[]
    for j in range(length):
        z=13.3-j*.40
        x=x0+math.sin(j*.58+branch)*.28+j*.045
        y=.51-branch*.045
        pts.append((x,y,z))
        for side in [-1,1]:
            leaf(x+side*random.uniform(.14,.35),y-.08-random.uniform(0,.05),z,random.uniform(.46,.86),side*random.uniform(.25,1.1),random.randrange(5))
    line('Trailing ivy stem',pts,.014,stem)

# Replace the countertop with its empty inset basin through Blender MCP.
exec(compile((ROOT / 'scripts/build-inset-counter.py').read_text(encoding='utf-8-sig'), 'build-inset-counter.py', 'exec'))
exec(compile((ROOT / 'scripts/detail-cafe-scene.py').read_text(encoding='utf-8-sig'), 'detail-cafe-scene.py', 'exec'))

# Merge repeated small meshes by material to keep draw calls low.
for mat in [paper,ink,stem,*leaves]:
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.materials)==1 and o.data.materials[0]==mat]
    if len(objects)>1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True);bpy.context.view_layer.objects.active=o
            for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        bpy.context.object.name=mat.name+' geometry'
for img in bpy.data.images:
    if img.source == 'FILE':
        if img.size[0] == 0: img.reload()
        if img.size[0] == 0: raise RuntimeError('Missing scene texture: ' + img.filepath)
        img.filepath = '//textures/' + Path(img.filepath).name
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'afternoon-room.blend'), relative_remap=False)
bpy.ops.export_scene.gltf(filepath=str(ASSETS/'afternoon-room.glb'),export_format='GLB',export_image_format='WEBP',export_image_quality=90,export_apply=True)
print('AFTERNOON_SCENE_READY',len(bpy.context.scene.objects),flush=True)





