"""MHR topology stamps. Must match types/hmr.ts."""

MHR_VERTEX_COUNT = 18439
MHR_JOINT_COUNT = 127
MHR_TOPOLOGY_VERSION = "mhr-18439-127"
# Native 127-joint layout used by SAM 3D Body `pred_joint_coords` and MHR
# skeleton_state: `body_world` at 0, then the official 126 MHR bones
# (facebookresearch/sam-3d-body#34). Torso landmarks for ISO girth windows.
MHR_JOINT_BODY_WORLD = 0
MHR_JOINT_ROOT = 1
MHR_JOINT_L_UPLEG = 2
MHR_JOINT_R_UPLEG = 18
MHR_JOINT_C_SPINE0 = 34
MHR_JOINT_C_SPINE1 = 35
MHR_JOINT_C_SPINE2 = 36
MHR_JOINT_C_SPINE3 = 37
MHR_JOINT_R_CLAVICLE = 38
MHR_JOINT_R_UPARM = 39
MHR_JOINT_L_CLAVICLE = 73
MHR_JOINT_L_UPARM = 74
MHR_JOINT_C_NECK = 109
# Cloth collider (Phase 4). Official LOD 3 is ~4,899 verts; accept a tight band
# around that after cluster decimation of the live LOD 1 mesh.
MHR_LOD3_VERTEX_COUNT = 4899
MHR_LOD3_VERTEX_MIN = 4000
MHR_LOD3_VERTEX_MAX = 6000
MHR_IDENTITY_DIM = 45
MHR_BODY_IDENTITY_DIM = 20
MHR_SKELETON_DIM = 68
MHR_MODEL_PARAM_DIM = 204
MHR_POSE_DIM = 136  # translation (3) + global rot (3) + body joints (130)
# Momentum skeleton_state last dim: coords [0:3], quaternion xyzw [3:7], scale [7].
MHR_SKELETON_STATE_DIM = 8
MHR_SKELETON_POS_START = 0
MHR_SKELETON_POS_END = 3
MHR_SKELETON_QUAT_START = 3
MHR_SKELETON_QUAT_END = 7
MHR_SKELETON_SCALE_INDEX = 7
# Canonical joint rotations: 127 xyzw quaternions, not 3D positions.
MHR_JOINT_QUAT_DIM = MHR_JOINT_COUNT * 4
SAM3D_HF_REPO = "facebook/sam-3d-body-dinov3"
SAM2_HF_ID = "facebook/sam2.1-hiera-large"
