#!/usr/bin/env python3
"""Blender の .blend から、サイトで使う .glb を書き出す。

Blender 本体を入れなくても、PyPI の bpy(Blender をPythonから使うもの)で動きます。

  python3 -m pip install --target /tmp/bpylib "bpy==4.5.13"
  PYTHONPATH=/tmp/bpylib python3 scripts/blend-to-glb.py house.blend --list
  PYTHONPATH=/tmp/bpylib python3 scripts/blend-to-glb.py house.blend -o assets/models/house-a.glb
  PYTHONPATH=/tmp/bpylib python3 scripts/blend-to-glb.py houses.blend -c 単棟 -o assets/models/house-a.glb

--list  中身(コレクション・オブジェクト・寸法・面数)を表示するだけ
-c      指定したコレクションだけを書き出す(1つの .blend に何棟も入っているとき)
-o      書き出し先。既定は .blend と同じ名前の .glb
"""
import argparse, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("blend")
    ap.add_argument("-o", "--out")
    ap.add_argument("-c", "--collection")
    ap.add_argument("--list", action="store_true", dest="do_list")
    a = ap.parse_args()

    import bpy
    from mathutils import Vector

    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = sum(len(o.data.loop_triangles) if o.data.loop_triangles else
               sum(max(len(p.vertices) - 2, 0) for p in o.data.polygons) for o in meshes)
    print(f"Blender {bpy.app.version_string} / {a.blend}")
    print(f"コレクション: {', '.join(c.name for c in bpy.data.collections) or '(なし)'}")
    print(f"メッシュ {len(meshes)}個 / 約 {tris:,} 面")
    if meshes:
        lo = Vector((min(min((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in meshes) for i in range(3)))
        hi = Vector((max(max((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in meshes) for i in range(3)))
        size = hi - lo
        print(f"全体の大きさ: X {size.x:.2f}m × Y {size.y:.2f}m × Z {size.z:.2f}m  (Blenderの座標系)")
        print("  ※ ハウスなら X か Y が間口・もう一方が奥行・Z が高さになっているはずです")
    if a.do_list:
        for o in bpy.data.objects:
            d = o.dimensions
            print(f"  - {o.name} [{o.type}] {d.x:.2f} × {d.y:.2f} × {d.z:.2f} m")
        return 0

    # 指定コレクション以外を外す
    if a.collection:
        target = bpy.data.collections.get(a.collection)
        if not target:
            print(f"コレクション「{a.collection}」がありません", file=sys.stderr); return 1
        keep = set(target.all_objects)
        for o in list(bpy.data.objects):
            if o not in keep:
                bpy.data.objects.remove(o, do_unlink=True)

    out = a.out or os.path.splitext(a.blend)[0] + ".glb"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out),
        export_format="GLB",
        export_apply=True,            # モディファイアーを適用
        export_yup=True,              # glTF は Y が上
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
        use_selection=False,
    )
    mb = os.path.getsize(out) / 1024 / 1024
    print(f"書き出しました: {out}  {mb:.1f}MB")
    if mb > 20:
        print("※ 20MBを超えています。スマホでは重いので、テクスチャを小さくするか面数を減らすことをおすすめします。")
    return 0

if __name__ == "__main__":
    sys.exit(main())
