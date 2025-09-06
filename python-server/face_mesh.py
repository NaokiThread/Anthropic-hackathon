import cv2
import numpy as np
from PIL import Image
import mediapipe as mp
import trimesh
from typing import Optional, Dict, Any, Tuple, List
from config import config
import logging
import io
import matplotlib.pyplot as plt

logger = logging.getLogger(__name__)


class FaceMeshProcessor:
    def __init__(self):
        """3D face mesh処理クラス"""
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles

        # Face mesh初期化（横顔・斜め顔にも対応）
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.3,  # 検出感度を上げる
            min_tracking_confidence=0.3,
        )

        logger.info("FaceMeshProcessor initialized")

    def is_ready(self) -> bool:
        """プロセッサーが準備完了かチェック"""
        return self.face_mesh is not None

    async def build_mesh(self, pil_image: Image.Image) -> Optional[trimesh.Trimesh]:
        """
        PIL画像から3D face meshを構築（正面・横顔・斜め顔に対応）

        Args:
            pil_image: PIL画像オブジェクト

        Returns:
            trimesh.Trimesh: 3Dメッシュオブジェクト
        """
        try:
            # PIL画像をOpenCV形式に変換
            cv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)

            # 顔の向きを検出
            face_orientation = self._detect_face_orientation(cv_image)
            logger.info(f"Detected face orientation: {face_orientation}")

            # MediaPipeで顔のランドマーク検出
            results = self.face_mesh.process(cv_image)

            if not results.multi_face_landmarks:
                logger.warning("No face landmarks detected")
                return None

            # 最初の顔のランドマークを取得
            face_landmarks = results.multi_face_landmarks[0]

            # 3Dメッシュに変換（顔の向きを考慮）
            mesh = self._landmarks_to_mesh(
                face_landmarks, cv_image.shape, face_orientation
            )

            logger.info(
                f"Successfully built 3D mesh with {len(mesh.vertices)} vertices for {face_orientation} face"
            )
            return mesh

        except Exception as e:
            logger.error(f"Error building mesh: {str(e)}")
            return None

    def _detect_face_orientation(self, cv_image) -> str:
        """顔の向きを検出"""
        try:
            # 簡易的な顔の向き検出
            # 左右の目の位置を比較して判定
            results = self.face_mesh.process(cv_image)
            if not results.multi_face_landmarks:
                return "unknown"

            landmarks = results.multi_face_landmarks[0]

            # 左右の目の中心点を取得
            left_eye_center = np.mean(
                [
                    [landmarks.landmark[33].x, landmarks.landmark[33].y],
                    [landmarks.landmark[7].x, landmarks.landmark[7].y],
                    [landmarks.landmark[163].x, landmarks.landmark[163].y],
                    [landmarks.landmark[144].x, landmarks.landmark[144].y],
                ],
                axis=0,
            )

            right_eye_center = np.mean(
                [
                    [landmarks.landmark[362].x, landmarks.landmark[362].y],
                    [landmarks.landmark[382].x, landmarks.landmark[382].y],
                    [landmarks.landmark[380].x, landmarks.landmark[380].y],
                    [landmarks.landmark[374].x, landmarks.landmark[374].y],
                ],
                axis=0,
            )

            # 目の位置差から向きを判定
            eye_diff = left_eye_center[0] - right_eye_center[0]

            if abs(eye_diff) < 0.1:
                return "front"  # 正面
            elif eye_diff > 0.1:
                return "left"  # 左向き
            else:
                return "right"  # 右向き

        except Exception as e:
            logger.warning(f"Error detecting face orientation: {str(e)}")
            return "unknown"

    def _landmarks_to_mesh(
        self,
        landmarks,
        image_shape: Tuple[int, int, int],
        face_orientation: str = "front",
    ) -> trimesh.Trimesh:
        """
        顔のランドマークから3Dメッシュを生成（顔の向きを考慮）

        Args:
            landmarks: MediaPipeの顔ランドマーク
            image_shape: 画像の形状 (height, width, channels)
            face_orientation: 顔の向き ("front", "left", "right", "unknown")

        Returns:
            trimesh.Trimesh: 3Dメッシュ
        """
        height, width = image_shape[:2]

        # ランドマークを3D座標に変換（顔の向きを考慮）
        vertices = []
        for landmark in landmarks.landmark:
            # 正規化座標を実際のピクセル座標に変換
            x = landmark.x * width
            y = landmark.y * height
            z = landmark.z * width  # Z座標もスケール調整

            # 顔の向きに応じて座標を調整
            if face_orientation == "left":
                # 左向きの場合、Z座標を調整
                z = z * 0.5  # 奥行きを浅くする
            elif face_orientation == "right":
                # 右向きの場合、Z座標を調整
                z = z * 0.5  # 奥行きを浅くする

            vertices.append([x, y, z])

        vertices = np.array(vertices)

        # より効率的な面生成：Delaunay三角分割を使用
        faces = self._generate_triangular_faces(vertices)

        # trimeshオブジェクトを作成（画像ピクセル座標のまま保持）
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        # 元画像サイズ・スケール情報をメタデータとして保持
        try:
            mesh.metadata = getattr(mesh, "metadata", {}) or {}
            mesh.metadata["image_size"] = (int(width), int(height))
            # 推定px/mm（瞳孔間距離ベース）
            # MediaPipeの代表点: 左目外側(33)と右目外側(362)
            try:
                left = landmarks.landmark[33]
                right = landmarks.landmark[362]
                lx, ly = left.x * width, left.y * height
                rx, ry = right.x * width, right.y * height
                ipd_px = float(np.hypot(lx - rx, ly - ry))
                ipd_mm = float(config.get_assumptions().get("ipd_mm_default", 63.0))
                px_per_mm = ipd_px / max(1e-6, ipd_mm)
                mesh.metadata["px_per_mm"] = px_per_mm
            except Exception:
                # フォールバック
                mesh.metadata["px_per_mm"] = 12.5
        except Exception:
            pass
        return mesh

    def _generate_triangular_faces(self, vertices: np.ndarray) -> List[List[int]]:
        """Delaunay三角分割を使用して面を生成"""
        try:
            from scipy.spatial import Delaunay

            # 2D投影で三角分割を実行（Z座標を無視）
            points_2d = vertices[:, :2]  # X, Y座標のみ使用

            # Delaunay三角分割
            tri = Delaunay(points_2d)

            # 三角形の面を生成
            faces = tri.simplices.tolist()

            logger.info(
                f"Generated {len(faces)} triangular faces using Delaunay triangulation"
            )
            return faces

        except ImportError:
            logger.warning("scipy not available, using simple face generation")
            return self._generate_simple_faces(vertices)

    def _generate_simple_faces(self, vertices: np.ndarray) -> List[List[int]]:
        """簡易的な面を生成（Delaunay三角分割の代替）"""
        faces = []
        n_vertices = len(vertices)

        # 顔の主要な部分の面を手動で定義
        # これは簡易版なので、実際の顔の構造に基づいていません

        # 鼻の部分
        if n_vertices > 20:
            faces.extend(
                [[1, 2, 3], [2, 3, 4], [3, 4, 5], [4, 5, 6], [5, 6, 7], [6, 7, 8]]
            )

        # 目の周り
        if n_vertices > 50:
            faces.extend(
                [
                    [33, 7, 163],
                    [7, 163, 144],
                    [163, 144, 145],
                    [144, 145, 153],
                    [145, 153, 154],
                    [153, 154, 155],
                ]
            )

        # 口の周り
        if n_vertices > 100:
            faces.extend(
                [
                    [61, 84, 17],
                    [84, 17, 18],
                    [17, 18, 19],
                    [18, 19, 20],
                    [19, 20, 21],
                    [20, 21, 22],
                ]
            )

        # 面の頂点インデックスが有効かチェック
        valid_faces = []
        for face in faces:
            if all(0 <= idx < n_vertices for idx in face):
                valid_faces.append(face)

        return valid_faces

    def visualize_mesh(
        self,
        mesh,
        canvas_size=(800, 600),
        draw_indices=True,
        use_faces=True,
        background_image: Optional[Image.Image] = None,
        alpha_wire=0.45,
        draw_points: bool = True,
        line_thickness: int = 1,
        line_bgr: Tuple[int, int, int] = (255, 127, 0),
    ):
        """
        2D 正射影でワイヤーフレームを描く。
        - mesh.vertices: (N,3)
        - mesh.faces: (M,3) があるなら三角形で描く。無ければ既定の接続で線分描画。
        """
        # 背景画像がある場合は背景画像サイズを優先
        if background_image is not None:
            W, H = background_image.size
        else:
            W, H = canvas_size

        verts = np.asarray(mesh.vertices)  # (N,3)
        x = verts[:, 0]
        y = verts[:, 1]

        # スケーリング方針:
        # - 背景画像あり or メタデータ(image_size)あり: ピクセル座標としてスケール
        # - それ以外: 0..1 正規化とみなしてキャンバスにスケール
        img_w, img_h = None, None
        if hasattr(mesh, "metadata") and isinstance(getattr(mesh, "metadata"), dict):
            size_meta = mesh.metadata.get("image_size")
            if isinstance(size_meta, (list, tuple)) and len(size_meta) == 2:
                img_w, img_h = int(size_meta[0]), int(size_meta[1])

        if background_image is not None:
            # OpenCVで背景に直接オーバーレイ（画像座標: 上=0, 左=0）
            bg = background_image.convert("RGB")
            W, H = bg.size
            img_rgb = np.array(bg.resize((W, H)))

            # メタデータの原画像サイズがあればスケール
            if not (img_w and img_h):
                img_w, img_h = W, H
            scale_x = float(W) / float(img_w)
            scale_y = float(H) / float(img_h)
            Xp = (x * scale_x).astype(np.int32)
            Yp = (y * scale_y).astype(np.int32)

            # ワイヤー/点の色（統一色）
            # 引数から受け取った BGR を元に RGB を算出して統一
            line_color_bgr = (int(line_bgr[0]), int(line_bgr[1]), int(line_bgr[2]))
            line_color_rgb = (
                line_color_bgr[2] / 255.0,
                line_color_bgr[1] / 255.0,
                line_color_bgr[0] / 255.0,
            )
            alpha = max(0.05, min(0.95, float(alpha_wire)))
            thickness = max(1, int(line_thickness))
            # OpenCV の参照をローカルに確定（スコープ誤認の回避）
            cv2_local = globals().get("cv2", None)
            # アンチエイリアス
            line_type = getattr(cv2_local, "LINE_AA", 8)

            try:
                # Draw in BGR space then convert back to RGB for PIL
                img_bgr = cv2_local.cvtColor(img_rgb, cv2_local.COLOR_RGB2BGR) if cv2_local is not None else img_rgb.copy()
                # IMPORTANT: draw onto a transparent overlay, not a copy of the base.
                # If we draw on a copy of the base and blend with addWeighted(img_draw, a, img_bgr, 1-a),
                # the perceived stroke darkness varies with background brightness (because base gets scaled by 1-a).
                # By drawing onto a black overlay and then doing base + a*overlay, only the strokes are blended,
                # which keeps visual intensity consistent between BEFORE/AFTER images.
                overlay = np.zeros_like(img_bgr)
                if (
                    use_faces
                    and hasattr(mesh, "faces")
                    and mesh.faces is not None
                    and len(mesh.faces) > 0
                ):
                    # Draw unique edges once to avoid double-thick lines due to
                    # shared edges between adjacent triangles.
                    faces = np.asarray(mesh.faces, dtype=np.int32)
                    unique_edges = set()
                    for tri in faces:
                        i, j, k = int(tri[0]), int(tri[1]), int(tri[2])
                        if i < len(Xp) and j < len(Xp):
                            unique_edges.add(tuple(sorted((i, j))))
                        if j < len(Xp) and k < len(Xp):
                            unique_edges.add(tuple(sorted((j, k))))
                        if k < len(Xp) and i < len(Xp):
                            unique_edges.add(tuple(sorted((k, i))))

                    for a, b in unique_edges:
                        cv2_local.line(
                            overlay,
                            (int(Xp[a]), int(Yp[a])),
                            (int(Xp[b]), int(Yp[b])),
                            line_color_bgr,
                            thickness,
                            lineType=line_type,
                        )
                else:
                    try:
                        from mediapipe.python.solutions.face_mesh_connections import (
                            FACEMESH_TESSELATION,
                        )

                        for i, j in FACEMESH_TESSELATION:
                            if i < len(Xp) and j < len(Xp):
                                cv2_local.line(
                                    overlay,
                                    (int(Xp[i]), int(Yp[i])),
                                    (int(Xp[j]), int(Yp[j])),
                                    line_color_bgr,
                                    thickness,
                                    lineType=line_type,
                                )
                    except Exception:
                        pass

                if draw_points and cv2_local is not None:
                    for xi, yi in zip(Xp, Yp):
                        cv2_local.circle(overlay, (int(xi), int(yi)), 1, line_color_bgr, -1)

                # Alpha blend only the strokes: result = base + alpha * overlay
                # Using weights (base: 1.0, overlay: alpha) ensures background pixels remain unchanged.
                result_bgr = cv2_local.addWeighted(img_bgr, 1.0, overlay, alpha, 0) if cv2_local is not None else overlay

                # インデックスは背景オーバーレイ時はデフォルト非表示（draw_indices=False推奨）
                if draw_indices and cv2_local is not None:
                    for idx, (xi, yi) in enumerate(zip(Xp, Yp)):
                        cv2_local.putText(
                            result_bgr,
                            str(idx),
                            (int(xi), int(yi)),
                            getattr(cv2_local, "FONT_HERSHEY_SIMPLEX", 0),
                            0.25,
                            (0, 0, 0),
                            1,
                            getattr(cv2_local, "LINE_AA", line_type),
                        )

                result_rgb = cv2_local.cvtColor(result_bgr, cv2_local.COLOR_BGR2RGB) if cv2_local is not None else result_bgr[:, :, ::-1]
                return Image.fromarray(result_rgb)
            except Exception as e:
                logger.warning(f"OpenCV overlay failed, fallback to matplotlib: {e}")
                # フォールバックは下のmatplotlib描画に続行

        if img_w and img_h:
            # ピクセル座標 → キャンバス座標へ等方スケール（軸別スケール）
            scale_x = float(W) / float(img_w)
            scale_y = float(H) / float(img_h)
            Xp = x * scale_x
            Yp = H - (y * scale_y)
        else:
            # 0..1 正規化として扱う
            def _minmax(v):
                vmin, vmax = float(v.min()), float(v.max())
                return (v - vmin) / max(1e-8, (vmax - vmin))

            x = _minmax(x)
            y = _minmax(y)
            Xp = x * W
            Yp = H - (y * H)
        fig = plt.figure(figsize=(W / 100.0, H / 100.0), dpi=100)
        ax = plt.gca()
        ax.set_xlim(0, W)
        ax.set_ylim(0, H)
        ax.axis("off")

        # 背景に元画像を表示（存在する場合）
        if background_image is not None:
            try:
                bg = background_image.convert("RGB").resize((W, H))
                ax.imshow(bg, extent=[0, W, 0, H], origin="upper")
            except Exception as e:
                logger.warning(f"Failed to draw background image: {e}")

        if (
            use_faces
            and hasattr(mesh, "faces")
            and mesh.faces is not None
            and len(mesh.faces) > 0
        ):
            # 三角形でワイヤーフレーム
            import matplotlib.tri as mtri

            triang = mtri.Triangulation(Xp, Yp, triangles=mesh.faces)
            ax.triplot(
                triang,
                linewidth=max(0.6, float(line_thickness)),
                color=(
                    line_color_rgb[0],
                    line_color_rgb[1],
                    line_color_rgb[2],
                    alpha_wire,
                ),
            )
        else:
            # 既定の接続で線分を描く（MediaPipe の接続を利用）
            try:
                from mediapipe.python.solutions.face_mesh_connections import (
                    FACEMESH_TESSELATION,
                )

                for i, j in FACEMESH_TESSELATION:
                    ax.plot(
                        [Xp[i], Xp[j]],
                        [Yp[i], Yp[j]],
                        linewidth=max(0.3, float(line_thickness) * 0.6),
                        color=(
                            line_color_rgb[0],
                            line_color_rgb[1],
                            line_color_rgb[2],
                            alpha_wire,
                        ),
                    )
            except Exception:
                # 接続が無い場合は点だけ
                pass

        # 点を薄く重ねる
        if draw_points:
            ax.scatter(
                Xp,
                Yp,
                s=3,
                c=[
                    (
                        line_color_rgb[0],
                        line_color_rgb[1],
                        line_color_rgb[2],
                        min(alpha_wire, 0.5),
                    )
                ],
            )

        # インデックス表示（小さく）
        if draw_indices:
            for idx, (xx, yy) in enumerate(zip(Xp, Yp)):
                ax.text(xx, yy, str(idx), fontsize=4)

        # 画像として返す
        buf = io.BytesIO()
        fig.canvas.draw()
        fig.savefig(buf, format="png", pad_inches=0)
        plt.close(fig)
        buf.seek(0)
        return Image.open(buf)

    def _create_simple_mesh_visualization(
        self, mesh: trimesh.Trimesh, image_size: Tuple[int, int]
    ) -> Image.Image:
        """matplotlibがない場合の簡易メッシュ可視化"""
        width, height = image_size

        # 空白画像を作成
        img = Image.new("RGB", (width, height), (255, 255, 255))

        # メッシュの頂点を2Dに投影
        vertices = mesh.vertices

        # 正規化（-1 to 1 の範囲）
        vertices_2d = vertices[:, :2].copy()
        vertices_2d[:, 0] = (vertices_2d[:, 0] - vertices_2d[:, 0].min()) / (
            vertices_2d[:, 0].max() - vertices_2d[:, 0].min()
        ) * 2 - 1
        vertices_2d[:, 1] = (vertices_2d[:, 1] - vertices_2d[:, 1].min()) / (
            vertices_2d[:, 1].max() - vertices_2d[:, 1].min()
        ) * 2 - 1

        # 画像座標に変換
        vertices_2d[:, 0] = (vertices_2d[:, 0] + 1) * width / 2
        vertices_2d[:, 1] = (vertices_2d[:, 1] + 1) * height / 2

        # 簡易的な描画（OpenCVを使用）
        try:
            img_array = np.array(img)

            # 各頂点を描画
            for vertex in vertices_2d:
                x, y = int(vertex[0]), int(vertex[1])
                if 0 <= x < width and 0 <= y < height:
                    cv2.circle(img_array, (x, y), 1, (0, 0, 255), -1)

            return Image.fromarray(img_array)

        except ImportError:
            # OpenCVもない場合は、最もシンプルな画像を返す
            return img

    async def analyze_face(self, pil_image: Image.Image) -> Dict[str, Any]:
        """
        顔の特徴を分析

        Args:
            pil_image: PIL画像オブジェクト

        Returns:
            Dict: 顔の分析結果
        """
        try:
            cv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
            results = self.face_mesh.process(cv_image)

            if not results.multi_face_landmarks:
                return {"error": "No face detected"}

            face_landmarks = results.multi_face_landmarks[0]

            # 基本的な顔の特徴を計算
            analysis = {
                "face_detected": True,
                "landmark_count": len(face_landmarks.landmark),
                "image_size": pil_image.size,
                "confidence": "high",  # MediaPipeの信頼度情報があれば使用
            }

            # 顔の向きや表情の分析（簡易版）
            # 実際の実装では、より詳細な分析を行う

            return analysis

        except Exception as e:
            logger.error(f"Error analyzing face: {str(e)}")
            return {"error": str(e)}

    def get_face_regions(self, landmarks) -> Dict[str, list]:
        """
        顔の各部位のランドマークインデックスを取得

        Returns:
            Dict: 各部位のランドマークインデックス
        """
        # MediaPipeの顔の部位定義を使用
        regions = {
            "face_oval": list(range(10, 17))
            + list(range(17, 22))
            + list(range(22, 27)),
            "left_eye": list(range(33, 42)),
            "right_eye": list(range(362, 373)),
            "nose": list(range(1, 10)),
            "mouth": list(range(61, 84)),
            "left_eyebrow": list(range(70, 76)),
            "right_eyebrow": list(range(300, 307)),
        }

        return regions
