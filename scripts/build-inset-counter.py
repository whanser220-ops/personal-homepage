"""Replace the countertop with a genuinely recessed, fruit-free water basin.

Can run on the saved Blender scene through MCP, or at the end of a full build.
Dimensions are authored in Blender X/right, Y/depth, Z/up coordinates.
"""
import bpy
import bmesh
from mathutils import Vector

# Remove the previous freestanding aquarium and counter, preserving the room.
for obj in list(bpy.context.scene.objects):
    if obj.name.startswith(('Tank', 'Counter ', 'Whitewashed counter', 'Plank seam', 'Slab joint', 'Plaster patina')):
        bpy.data.objects.remove(obj, do_unlink=True)
# Earlier exports combined pencil lines into one mesh. Remove only counter marks.
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or not any(m and m.name.startswith('Pencil edges') for m in obj.data.materials):
        continue
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    def obsolete_mark(face):
        points=[obj.matrix_world @ v.co for v in face.verts]
        counter_mark=all(p.y < -1.2 and p.z < 4.5 for p in points)
        old_cup_rim=all(1.3 < p.x < 3.3 and -2.4 < p.y < -.8 and 4.1 < p.z < 5.4 for p in points)
        return counter_mark or old_cup_rim
    marked = [f for f in bm.faces if obsolete_mark(f)]
    if marked:
        bmesh.ops.delete(bm, geom=marked, context='FACES')
        bm.to_mesh(obj.data)
        obj.data.update()
    bm.free()


def inset_material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = .55
    return mat


stone = inset_material('Inset pale limestone', (.82,.85,.81))
liner = inset_material('Inset porcelain', (.35,.59,.55))
grout = inset_material('Inset grout', (.24,.39,.37))
water_mat = inset_material('Inset water marker', (.08,.35,.29))
glass_mat = inset_material('Inset glass marker', (.60,.86,.81))
wood_mat = bpy.data.materials.get('Whitewashed wood')


def inset_mesh(name, verts, faces, mat, uv=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    if uv:
        layer = data.uv_layers.new(name='UVMap')
        for poly in data.polygons:
            for li in poly.loop_indices:
                layer.data[li].uv = uv[data.loops[li].vertex_index]
    return obj


def inset_box(name, lo, hi, mat, bevel=0):
    x,y,z=lo; X,Y,Z=hi
    verts=[(x,y,z),(X,y,z),(X,Y,z),(x,Y,z),(x,y,Z),(X,y,Z),(X,Y,Z),(x,Y,Z)]
    obj=inset_mesh(name,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],mat)
    if bevel:
        mod=obj.modifiers.new('Soft stone edge','BEVEL');mod.width=bevel;mod.segments=3
        obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return obj


# Opening: x [-2.33, 2.57], depth [-4.60, -1.02]. Water sits below the lip.
left,right=-2.33,2.57
front,back=-4.60,-1.02
top,bottom=4.55,2.40
# Four slab segments form an actual opening, with no hidden solid slab underneath.
inset_box('Counter left slab',(-16,-4.80,4.30),(left,-.75,top),stone,.025)
inset_box('Counter right slab',(right,-4.80,4.30),(16,-.75,top),stone,.025)
inset_box('Counter rear lip',(left,back,4.30),(right,-.75,top),stone,.018)
inset_box('Counter front lip',(left,-4.80,4.30),(right,front,top),stone,.018)
# Lower cabinetry has an integrated glass window, not a glass box above the desk.
inset_box('Counter left cabinet',(-16,-4.70,-.6),(left-.10,-.85,4.30),stone)
inset_box('Counter right cabinet',(right+.10,-4.70,-.6),(16,-.85,4.30),stone)
inset_box('Counter beneath basin',(left-.10,-4.70,-.6),(right+.10,-.85,bottom-.07),stone)

def cabinet_face(name,x0,x1,z0,z1):
    inset_mesh(name,[(x0,-4.715,z0),(x1,-4.715,z0),(x1,-4.715,z1),(x0,-4.715,z1)],[(0,1,2,3)],wood_mat,[(x0/6,0),(x1/6,0),(x1/6,(z1-z0)/4),(x0/6,(z1-z0)/4)])
cabinet_face('Whitewashed counter left',-16,left-.10,-.6,4.30)
cabinet_face('Whitewashed counter right',right+.10,16,-.6,4.30)
cabinet_face('Whitewashed counter lower',left-.10,right+.10,-.6,bottom-.07)
# Porcelain pool interior. A tiled floor gives refraction and caustics a real receiver.
inset_box('Tank basin floor',(left,front,bottom-.10),(right,back,bottom),liner,.01)
inset_box('Tank basin rear',(left,back,bottom),(right,back+.09,4.43),liner,.01)
inset_box('Tank basin left',(left-.09,front,bottom),(left,back,4.43),liner,.01)
inset_box('Tank basin right',(right,front,bottom),(right+.09,back,4.43),liner,.01)
for i in range(1,10):
    x=left+(right-left)*i/10
    inset_box('Tank floor grout',(x-.008,front,bottom+.001),(x+.008,back,bottom+.004),grout)
for i in range(1,7):
    y=front+(back-front)*i/7
    inset_box('Tank floor grout',(left,y-.008,bottom+.001),(right,y+.008,bottom+.004),grout)
# Front glass window is fully recessed behind the stone frame.
inset_mesh('Tank front glass',[(left,-4.625,bottom),(right,-4.625,bottom),(right,-4.625,4.34),(left,-4.625,4.34)],[(0,1,2,3)],glass_mat,[(0,0),(1,0),(1,1),(0,1)])
for x in [left-.10,right]:
    inset_box('Counter window jamb',(x,-4.76,bottom-.07),(x+.10,-4.60,4.30),stone,.014)
inset_box('Counter window sill',(left,-4.76,bottom-.07),(right,-4.60,bottom+.025),stone,.014)
# High-resolution grid for advected, multi-resolution wave-particle displacement.
nx,nz=96,64
verts=[];uv=[];faces=[]
for j in range(nz+1):
    for i in range(nx+1):
        verts.append((left+(right-left)*i/nx,front+(back-front)*j/nz,4.43))
        uv.append((i/nx,j/nz))
for j in range(nz):
    for i in range(nx):
        k=j*(nx+1)+i;faces.append((k,k+1,k+nx+2,k+nx+1))
inset_mesh('Tank water surface',verts,faces,water_mat,uv)
# Move the original cups onto the dry right-hand section once.
for obj in bpy.context.scene.objects:
    if obj.name.startswith(('Espresso','Ceramic bowl','Folded linen')) and not obj.get('inset_positioned'):
        obj.location.x += 2.5
        obj.location.z += .37
        obj['inset_positioned']=True
print('INSET_COUNTER_READY', len(bpy.context.scene.objects))

