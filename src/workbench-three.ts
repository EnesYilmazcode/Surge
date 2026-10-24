import * as THREE from 'three-classic'
import { OrbitControls } from 'three-classic/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three-classic/examples/jsm/environments/RoomEnvironment.js'

export const workbenchThree = { ...THREE, OrbitControls, RoomEnvironment }
