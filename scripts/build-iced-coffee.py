"""Blender model: open glass, closed two-color liquid volume and beveled ice."""
import bpy
import math
from mathutils import Euler, Vector

for obj in list(bpy.context.scene.objects):
    if obj.name.startswith(('IcedCoffee', 'Espresso')):
        bpy.data.objects.remove(obj, do_unlink=True)

def coffee_mat(name, color):
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes=True;mat.diffuse_color=(*color,1)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1)
    return mat

glass=coffee_mat('IcedCoffee glass',(.80,.92,.94))
liquid=coffee_mat('IcedCoffee liquid',(.64,.36,.12))
ice=coffee_mat('IcedCoffee ice',(.72,.90,.94))
base=Vector((5.55,-3.25,4.56))

def revolve(name, profile, material):
    segments=80;verts=[];faces=[]
    for r,z in profile:
        verts += [tuple(base+Vector((r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z))) for i in range(segments)]
    for j in range(len(profile)-1):
        for i in range(segments):
            k=j*segments+i;n=j*segments+(i+1)%segments
            faces.append((k,n,n+segments,k+segments))
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);data.materials.append(material)
    for p in data.polygons:p.use_smooth=True
    return obj

# Closed cross-section with a heavy clear base and a rounded, genuinely open lip.
revolve('IcedCoffee glass shell',[(0,.01),(.45,.01),(.48,.045),(.49,.13),(.625,1.64),(.628,1.68),(.614,1.70),(.595,1.68),(.594,1.64),(.455,.16),(.43,.125),(0,.125)],glass)
revolve('IcedCoffee liquid volume',[(0,.145),(.45,.145),(.562,1.37),(.573,1.40),(.566,1.415),(.54,1.395),(0,1.395)],liquid)

for index,(dx,dy,z,size,angles) in enumerate([
    (-.23,-.13,1.50,.44,(.22,.16,.35)),
    (.22,-.17,1.49,.42,(-.21,.26,-.22)),
    (.02,.23,1.55,.44,(.20,-.28,.50)),
    (-.03,-.10,.92,.35,(.31,.22,.13)),
]):
    bpy.ops.mesh.primitive_cube_add(size=size,location=base+Vector((dx,dy,z)))
    obj=bpy.context.object;obj.name=f'IcedCoffee ice {index:02d}'
    obj.rotation_euler=Euler(angles);obj.data.materials.append(ice)
    bevel=obj.modifiers.new('Melted rounded corners','BEVEL');bevel.width=.045;bevel.segments=3
    obj.modifiers.new('Ice facet normals','WEIGHTED_NORMAL')

print('ICED_COFFEE_READY',flush=True)
