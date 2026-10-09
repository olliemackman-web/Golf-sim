// Local attachment points inside item models (metres, relative to footprint centre, rot 0, front = +Z).

/** Car park slots (match the carpark model). rot = yaw the parked car faces. */
export const CARPARK_SLOTS: { x: number; z: number; rot: number }[] = [
  { x: -10, z: -5, rot: Math.PI }, { x: -6, z: -5, rot: Math.PI }, { x: -2, z: -5, rot: Math.PI },
  { x: 2, z: -5, rot: Math.PI }, { x: 6, z: -5, rot: Math.PI }, { x: 10, z: -5, rot: Math.PI },
  { x: -10, z: 5, rot: 0 }, { x: -6, z: 5, rot: 0 }, { x: 6, z: 5, rot: 0 }, { x: 10, z: 5, rot: 0 },
];
export const CARPARK_ENTRY = { x: 0, z: 8.5 };
export const CARPARK_AISLE_Z = 0;

/** Range bay: where the golfer stands (facing +X) and where the ball sits. Golfers hit towards -Z. */
export const BAY_STAND = { x: -0.7, z: -2.4 };
export const BAY_BALL = { x: 0, z: -2.4 };
export const BAY_WAIT = { x: 0, z: 2.2 };

/** Road lanes (world z). */
export const LANE_EAST_Z = 636.5;
export const LANE_WEST_Z = 632.5;
