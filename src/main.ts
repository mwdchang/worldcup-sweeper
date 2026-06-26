import './style.css';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  PointLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  PointerEventTypes,
  VertexData,
} from '@babylonjs/core';
import { BallGrids } from './ball';

interface VoronoiCell {
  index: number;
  center: Vector3;
  vertices: Vector3[];
  neighbors: number[];
  isPentagon: boolean;
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  mesh?: Mesh;
  material?: StandardMaterial;
  neighborMines: number;
}

class SphericalSweeper {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private camera!: ArcRotateCamera;
  private ballContainer!: Mesh;

  // Game Settings
  private hexagonCount = 80;
  private totalCells = 92; // 12 pentagons + H hexagons
  private mineCount = 15;
  private cells: VoronoiCell[] = [];
  private gameOver = false;
  private revealedCount = 0;
  private timeElapsed = 0;
  private timerInterval?: number;

  // DOM Elements
  private sizeSelect!: HTMLSelectElement;
  private mineCountEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private resetBtn!: HTMLElement;

  // Materials Cache
  private pentagonMat!: StandardMaterial;
  private flaggedMat!: StandardMaterial;
  private mineMat!: StandardMaterial;
  private revealedMat!: StandardMaterial;
  private textColors: Color3[] = [];

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);

    this.initDOM();
    this.initScene();
    this.initMaterials();
    this.initGame();
    this.animate();

    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  private initDOM() {
    this.sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
    this.mineCountEl = document.getElementById('mine-count')!;
    this.timerEl = document.getElementById('timer')!;
    this.resetBtn = document.getElementById('btn-reset')!;

    this.sizeSelect.addEventListener('change', () => {
      this.hexagonCount = parseInt(this.sizeSelect.value);
      this.initGame();
    });

    this.resetBtn.addEventListener('click', () => this.initGame());
  }

  private initScene() {
    // Elegant dark space background
    this.scene.clearColor = new Color3(0.04, 0.05, 0.08).toColor4(1.0);

    // Dynamic rotation camera
    this.camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      Math.PI / 2,
      6.5,
      new Vector3(0, 0, 0),
      this.scene
    );
    this.camera.attachControl(this.canvas, true);
    this.camera.lowerRadiusLimit = 4;
    this.camera.upperRadiusLimit = 12;

    // Allow free 360° vertical rotation (remove pole clamping)
    this.camera.lowerBetaLimit = null;
    this.camera.upperBetaLimit = null;

    // Configure global ambient lighting
    this.scene.ambientColor = new Color3(1, 1, 1);
    
    // Create an ambient hemispheric light without directional specular or diffuse highlights
    const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    ambientLight.diffuse = new Color3(0, 0, 0);
    ambientLight.specular = new Color3(0, 0, 0);
    ambientLight.groundColor = new Color3(0, 0, 0);

    // Soccer ball root mesh
    this.ballContainer = MeshBuilder.CreateSphere('ballContainer', { diameter: 0.1 }, this.scene);
    this.ballContainer.isPickable = false;

    // Inner dark sphere to block backfaces visible through patch gaps
    const innerSphere = MeshBuilder.CreateSphere('innerSphere', { diameter: 3.9, segments: 32 }, this.scene);
    innerSphere.isPickable = false;
    const innerMat = new StandardMaterial('innerSphereMat', this.scene);
    innerMat.diffuseColor = Color3.FromHexString('#111111');
    innerMat.ambientColor = Color3.FromHexString('#111111');
    innerMat.specularColor = new Color3(0, 0, 0);
    innerMat.emissiveColor = new Color3(0, 0, 0);
    innerMat.backFaceCulling = false;
    innerSphere.material = innerMat;
  }

  private initMaterials() {
    // Pentagons: #555555 surface color, completely matte
    this.pentagonMat = new StandardMaterial('pentagonMat', this.scene);
    this.pentagonMat.diffuseColor = Color3.FromHexString('#555555');
    this.pentagonMat.ambientColor = Color3.FromHexString('#555555');
    this.pentagonMat.specularColor = new Color3(0, 0, 0);
    this.pentagonMat.emissiveColor = new Color3(0, 0, 0);
    this.pentagonMat.roughness = 1.0;

    // Flagged: Matte Gold/Orange highlight
    this.flaggedMat = new StandardMaterial('flaggedMat', this.scene);
    this.flaggedMat.diffuseColor = new Color3(1.0, 0.6, 0.0);
    this.flaggedMat.ambientColor = new Color3(1.0, 0.6, 0.0);
    this.flaggedMat.specularColor = new Color3(0, 0, 0);
    this.flaggedMat.emissiveColor = new Color3(0, 0, 0);

    // Mine: Matte Red alarm
    this.mineMat = new StandardMaterial('mineMat', this.scene);
    this.mineMat.diffuseColor = new Color3(0.9, 0.1, 0.1);
    this.mineMat.ambientColor = new Color3(0.9, 0.1, 0.1);
    this.mineMat.specularColor = new Color3(0, 0, 0);
    this.mineMat.emissiveColor = new Color3(0, 0, 0);

    // Revealed: Matte Slate blue-gray
    this.revealedMat = new StandardMaterial('revealedMat', this.scene);
    this.revealedMat.diffuseColor = new Color3(0.12, 0.86, 0.24);
    this.revealedMat.ambientColor = new Color3(0.12, 0.86, 0.24);
    this.revealedMat.specularColor = new Color3(0, 0, 0);
    this.revealedMat.emissiveColor = new Color3(0, 0, 0);

    // Number indicator colors
    this.textColors = [
      new Color3(0.2, 0.6, 1.0), // 1: Blue
      new Color3(0.2, 0.8, 0.3), // 2: Green
      new Color3(1.0, 0.3, 0.3), // 3: Red
      new Color3(0.8, 0.3, 1.0), // 4: Purple
      new Color3(1.0, 0.7, 0.1), // 5: Yellow
      new Color3(0.1, 0.9, 0.9), // 6: Cyan
    ];
  }

  private initGame() {
    this.gameOver = false;
    this.revealedCount = 0;
    this.timeElapsed = 0;
    this.timerEl.textContent = '000';
    clearInterval(this.timerInterval);

    // Determine mine density (approx 18% of playable cells)
    this.totalCells = 12 + this.hexagonCount;
    this.mineCount = Math.max(3, Math.floor(this.hexagonCount * 0.18));
    this.mineCountEl.textContent = String(this.mineCount);

    // Clean up old meshes
    this.cells.forEach((cell) => {
      if (cell.mesh) cell.mesh.dispose();
    });

    // Load pre-calculated grid from ball.ts
    const precalculatedData = BallGrids[this.hexagonCount];
    this.cells = precalculatedData.map(data => ({
      index: data.index,
      center: new Vector3(data.center.x, data.center.y, data.center.z),
      vertices: data.vertices.map(v => new Vector3(v.x, v.y, v.z)),
      neighbors: data.neighbors,
      isPentagon: data.isPentagon,
      isMine: false,
      isRevealed: false,
      isFlagged: false,
      neighborMines: 0
    }));

    // Assign mines to hexagons only
    const hexagons = this.cells.filter((c) => !c.isPentagon);
    const mineIndices = new Set<number>();
    while (mineIndices.size < this.mineCount) {
      const idx = Math.floor(Math.random() * hexagons.length);
      mineIndices.add(hexagons[idx].index);
    }
    mineIndices.forEach((idx) => {
      this.cells[idx].isMine = true;
    });

    // Calculate neighbors and adjacent mines
    this.cells.forEach((cell) => {
      if (cell.isPentagon) {
        cell.neighborMines = 0;
        return;
      }
      let adjacentMines = 0;
      cell.neighbors.forEach((nIdx) => {
        if (this.cells[nIdx].isMine) {
          adjacentMines++;
        }
      });
      cell.neighborMines = adjacentMines;
    });

    // Build the 3D visual panels for the cells
    this.buildBallMeshes();

    // Interaction handler
    this.scene.onPointerObservable.clear();
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (this.gameOver) return;

      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        const event = pointerInfo.event as MouseEvent;
        
        // If pickInfo is null, perform a manual raycast pick from the event coordinates
        let pickResult = pointerInfo.pickInfo;
        if (!pickResult || !pickResult.hit) {
          pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
        }

        if (pickResult && pickResult.hit && pickResult.pickedMesh) {
          const meshName = pickResult.pickedMesh.name;
          if (meshName.startsWith('cell_')) {
            const cellIndex = parseInt(meshName.split('_')[1]);
            const cell = this.cells[cellIndex];

            if (cell.isPentagon) return; // Pentagons are unplayable

            // Start timer on first move
            if (this.timeElapsed === 0 && !this.timerInterval) {
              this.startTimer();
            }

            if (event.button === 2) {
              // Right click -> Flag
              this.toggleFlag(cell);
            } else if (event.button === 0) {
              // Left click -> Reveal
              this.revealCell(cell);
            }
          }
        }
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private startTimer() {
    this.timerInterval = window.setInterval(() => {
      this.timeElapsed++;
      this.timerEl.textContent = String(this.timeElapsed).padStart(3, '0');
    }, 1000);
  }

  // Build high-end 3D panels with beveled edges and gaps
  private buildBallMeshes() {
    this.cells.forEach((cell) => {
      const mesh = new Mesh(`cell_${cell.index}`, this.scene);
      mesh.parent = this.ballContainer;
      mesh.isPickable = true;

      const positions: number[] = [];
      const indices: number[] = [];
      const normals: number[] = [];

      // Cell geometry scaling parameters for beveling
      const radius = 2.0; // Ball radius scale
      const gapFactor = 0.94; // Creates the lines between panels
      const height = 0.08; // Bevel depth

      const center = cell.center.scale(radius * 1.02);
      const topVertices: Vector3[] = [];
      const bottomVertices: Vector3[] = [];

      cell.vertices.forEach((v) => {
        // Blend vertex towards cell center for the panel gap spacing
        const edgePoint = Vector3.Lerp(cell.center, v, gapFactor);
        topVertices.push(edgePoint.scale(radius));
        bottomVertices.push(edgePoint.scale(radius - height));
      });

      // 1. Center vertex
      positions.push(center.x, center.y, center.z);

      // 2. Top surface panel vertices
      topVertices.forEach((tv) => {
        positions.push(tv.x, tv.y, tv.z);
      });

      // 3. Bottom surface panel vertices (for side-wall bevel rendering)
      bottomVertices.forEach((bv) => {
        positions.push(bv.x, bv.y, bv.z);
      });

      const vCount = cell.vertices.length;

      // 4. Construct indices for the top face fan (outward facing)
      for (let j = 0; j < vCount; j++) {
        indices.push(0, ((j + 1) % vCount) + 1, j + 1);
      }

      // 5. Construct indices for the side beveled walls (outward facing)
      for (let j = 0; j < vCount; j++) {
        const t1 = j + 1;
        const t2 = ((j + 1) % vCount) + 1;
        const b1 = t1 + vCount;
        const b2 = t2 + vCount;

        // Quad triangles facing outwards
        indices.push(t1, b1, b2);
        indices.push(t1, b2, t2);
      }

      // Compute normals automatically based on new winding order
      VertexData.ComputeNormals(positions, indices, normals);

      const vertexData = new VertexData();
      vertexData.positions = positions;
      vertexData.indices = indices;
      vertexData.normals = normals;
      vertexData.applyToMesh(mesh);
      mesh.refreshBoundingInfo();

      // Set material & colors
      const mat = new StandardMaterial(`mat_${cell.index}`, this.scene);
      mat.specularColor = new Color3(0, 0, 0);
      mat.emissiveColor = new Color3(0, 0, 0);

      if (cell.isPentagon) {
        mesh.material = this.pentagonMat;
      } else {
        // Hexagon: #dddddd default surface color
        mat.diffuseColor = Color3.FromHexString('#dddddd');
        mat.ambientColor = Color3.FromHexString('#dddddd');
        mesh.material = mat;
      }

      cell.mesh = mesh;
      cell.material = mat;
    });
  }

  private toggleFlag(cell: VoronoiCell) {
    if (cell.isRevealed) return;

    cell.isFlagged = !cell.isFlagged;
    if (cell.mesh) {
      if (cell.isFlagged) {
        cell.mesh.material = this.flaggedMat;
        cell.mesh.scaling.setAll(1.05); // Pop out slightly when flagged
      } else {
        cell.mesh.material = cell.material!;
        cell.mesh.scaling.setAll(1.0);
      }
    }
  }

  private revealCell(cell: VoronoiCell) {
    if (cell.isRevealed || cell.isFlagged) return;

    cell.isRevealed = true;
    this.revealedCount++;

    if (cell.mesh) {
      // cell.mesh.scaling.setAll(0.96); // Push down when clicked
      if (cell.isMine) {
        cell.mesh.material = this.mineMat;
        this.endGame(false);
        return;
      }

      cell.mesh.material = this.revealedMat;

      // Add number indicators on the sphere surface
      if (cell.neighborMines > 0) {
        const color = this.textColors[Math.min(cell.neighborMines - 1, this.textColors.length - 1)];
        const indicator = MeshBuilder.CreateSphere(`ind_${cell.index}`, { diameter: 0.15 }, this.scene);
        indicator.position = cell.center.scale(2.05);
        indicator.parent = this.ballContainer;
        indicator.isPickable = false;

        const indMat = new StandardMaterial(`indMat_${cell.index}`, this.scene);
        indMat.diffuseColor = color;
        indMat.ambientColor = color;
        indMat.specularColor = new Color3(0, 0, 0);
        indMat.emissiveColor = new Color3(0, 0, 0);
        indicator.material = indMat;
      }
    }

    // Auto reveal adjacent hexagons if neighborMines = 0
    if (cell.neighborMines === 0) {
      cell.neighbors.forEach((nIdx) => {
        const neighbor = this.cells[nIdx];
        if (!neighbor.isPentagon && !neighbor.isRevealed && !neighbor.isFlagged) {
          this.revealCell(neighbor);
        }
      });
    }

    // Check Win
    const totalPlayableHexagons = this.hexagonCount;
    const safeCells = totalPlayableHexagons - this.mineCount;
    if (this.revealedCount === safeCells) {
      this.endGame(true);
    }
  }

  private endGame(win: boolean) {
    this.gameOver = true;
    clearInterval(this.timerInterval);

    // Show all mine locations
    this.cells.forEach((cell) => {
      if (cell.isMine && cell.mesh) {
        cell.mesh.material = win ? this.flaggedMat : this.mineMat;
        cell.mesh.scaling.setAll(1.1);
      }
    });

    setTimeout(() => {
      alert(
        win
          ? '🏆 WORLD CUP WINNER! You swept the ball safely!'
          : '💥 RED CARD! You hit a soccer mine.'
      );
    }, 200);
  }

  private animate() {
    this.engine.runRenderLoop(() => {
      // Gentle camera render loop (auto-rotation disabled)
      this.scene.render();
    });
  }
}

// Start game
window.addEventListener('DOMContentLoaded', () => {
  new SphericalSweeper('renderCanvas');
});
