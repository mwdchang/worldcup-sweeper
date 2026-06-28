import './style.css';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  // PointLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  PointerEventTypes,
  VertexData,
  DynamicTexture,
  Observer
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

let downX: number, downY: number = 0;
let observer: Observer<any>;

class SphericalSweeper {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private camera!: ArcRotateCamera;
  private ballContainer!: Mesh;

  // Game Settings
  private hexagonCount = 80;
  private mineCount = 15;
  private flagged = 0;

  private cells: VoronoiCell[] = [];
  private gameOver = false;
  private revealedCount = 0;
  private timeElapsed = 0;
  private timerInterval?: number;
  private endInterval?: number;

  // DOM Elements
  private sizeSelect!: HTMLSelectElement;
  private mineCountEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private resetBtn!: HTMLElement;
  private overlayEl!: HTMLElement;

  // Materials Cache
  private pentagonMat!: StandardMaterial;
  private flaggedMat!: StandardMaterial;
  private mineMat!: StandardMaterial;
  private revealedMat!: StandardMaterial;
  private textColors: Color3[] = [];
  private indMaterials: StandardMaterial[] = [];

  // Adapt mesh
  private innerSphere!: Mesh;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);

    this.initDOM();
    this.initScene();
    this.initMaterials();
    this.initGame();
    this.animate();

    // window.addEventListener('resize', () => {
    //   this.engine.resize();
    // });
  }

  private initDOM() {
    this.sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
    this.mineCountEl = document.getElementById('mine-count')!;
    this.timerEl = document.getElementById('timer')!;
    this.resetBtn = document.getElementById('btn-reset')!;
    this.overlayEl = document.getElementById('overlay')!;

    this.sizeSelect.addEventListener('change', () => {
      this.hexagonCount = parseInt(this.sizeSelect.value);
      if (this.hexagonCount < 80) {
        this.innerSphere.scaling = new Vector3(0.9, 0.9, 0.9);
      } else {
        this.innerSphere.scaling = new Vector3(1.0, 1.0, 1.0);
      }
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
    this.innerSphere = MeshBuilder.CreateSphere('innerSphere', { diameter: 3.9, segments: 32 }, this.scene);
    this.innerSphere.isPickable = false;
    const innerMat = new StandardMaterial('innerSphereMat', this.scene);
    innerMat.diffuseColor = Color3.FromHexString('#55555');
    innerMat.ambientColor = Color3.FromHexString('#55555');
    innerMat.specularColor = new Color3(0, 0, 0);
    innerMat.emissiveColor = new Color3(0, 0, 0);
    innerMat.backFaceCulling = false;

    this.innerSphere.material = innerMat;
  }


  // Assign mines
  private setMines(clickIdx: number):void {
    if (!this.cells || this.cells.length <= 0) {
      return;
    }

    const hexagons = this.cells.filter((c) => !c.isPentagon);
    const mineIndices = new Set<number>();
    while (mineIndices.size < this.mineCount) {
      const idx = Math.floor(Math.random() * hexagons.length);
      if (hexagons[idx].index === clickIdx) continue;
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
  }

  private initMaterials() {
    // Pentagons
    this.pentagonMat = new StandardMaterial('pentagonMat', this.scene);
    this.pentagonMat.diffuseColor = Color3.FromHexString('#555555');
    this.pentagonMat.ambientColor = Color3.FromHexString('#555555');
    this.pentagonMat.specularColor = new Color3(0, 0, 0);
    this.pentagonMat.emissiveColor = new Color3(0, 0, 0);
    this.pentagonMat.roughness = 1.0;

    // Flagged
    this.flaggedMat = new StandardMaterial('flaggedMat', this.scene);
    this.flaggedMat.diffuseColor = new Color3(1.0, 0.6, 0.0);
    this.flaggedMat.ambientColor = new Color3(1.0, 0.6, 0.0);
    this.flaggedMat.specularColor = new Color3(0, 0, 0);
    this.flaggedMat.emissiveColor = new Color3(0, 0, 0);

    // Mine
    this.mineMat = new StandardMaterial('mineMat', this.scene);
    this.mineMat.diffuseColor = new Color3(0.9, 0.1, 0.1);
    this.mineMat.ambientColor = new Color3(0.9, 0.1, 0.1);
    this.mineMat.specularColor = new Color3(0, 0, 0);
    this.mineMat.emissiveColor = new Color3(0, 0, 0);

    // Revealed
    this.revealedMat = new StandardMaterial('revealedMat', this.scene);
    this.revealedMat.diffuseColor = new Color3(0.12, 0.76, 0.24);
    this.revealedMat.ambientColor = new Color3(0.12, 0.76, 0.24);
    this.revealedMat.specularColor = new Color3(0, 0, 0);
    this.revealedMat.emissiveColor = new Color3(0, 0, 0);

    // Number indicator colors
    this.textColors = [
      new Color3(0.2, 0.1, 0.2),
      new Color3(0.3, 0.1, 0.2),
      new Color3(0.4, 0.1, 0.2),
      new Color3(0.5, 0.1, 0.2),
      new Color3(0.6, 0.1, 0.2),
      new Color3(0.7, 0.1, 0.2),
    ];

    this.indMaterials = this.textColors.map((color, index) => {
      // Render the number onto a dynamic texture
      const dynTex = new DynamicTexture(`textTex_${index}`, { width: 128, height: 128 }, this.scene, false);
      dynTex.hasAlpha = true;
      dynTex.drawText(
        String(index + 1),
        null, null,
        'bold 100px sans-serif',
        color.toHexString(),
        'transparent',
        true
      );

      const indMat = new StandardMaterial(`indMat_${index}`, this.scene);
      indMat.diffuseTexture = dynTex;
      indMat.emissiveColor = Color3.White();
      indMat.specularColor = Color3.Black();
      indMat.useAlphaFromDiffuseTexture = true;
      indMat.backFaceCulling = false;
      return indMat;
    });
  }

  private initGame() {
    this.overlayEl!.style.display = 'none';
    this.gameOver = false;
    this.revealedCount = 0;
    this.timeElapsed = 0;
    this.timerEl.textContent = '000';
    clearInterval(this.timerInterval);

    // Determine mine density
    let density = 0;
    if (this.hexagonCount < 80) {
      density = 0.15;
    } else  if (this.hexagonCount < 180) {
      density = 0.25;
    } else {
      density = 0.33;
    }
    
    this.mineCount = Math.max(3, Math.floor(this.hexagonCount * density));
    this.mineCountEl.textContent = String(this.mineCount - this.flagged);

    // Clean up old meshes
    this.cells.forEach((cell) => {
      if (cell.mesh) cell.mesh.dispose();
    });

    if (this.scene) {
      this.scene.meshes
        .filter(mesh => mesh.name.startsWith("ind_"))
        .forEach(mesh => mesh.dispose());

      this.scene.meshes
        .filter(mesh => mesh.name.startsWith("cell_"))
        .forEach(mesh => mesh.dispose());
    }

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

    // Build the 3D visual panels for the cells
    this.buildBallMeshes();

    // Interaction handler
    if (observer) {
      // this.scene.onPointerObservable.clear();
      this.scene.onPointerObservable.remove(observer);
    }
    observer = this.scene.onPointerObservable.add((pointerInfo) => {
      if (this.gameOver) return;

      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        downX = pointerInfo.event.clientX;
        downY = pointerInfo.event.clientY;
        return;
      }

      if (pointerInfo.type === PointerEventTypes.POINTERUP) {
        const event = pointerInfo.event as MouseEvent;

        if (Math.abs(event.clientX - downX) > 3 ||
            Math.abs(event.clientY - downY) > 3) {
          return;
        }
        
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

            // Pentagons are unplayable
            if (cell.isPentagon) return;

            // Start timer on first move
            if (this.timeElapsed === 0 && !this.timerInterval) {
              this.setMines(cellIndex);
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
      const gapFactor = 0.93; // Creates the lines between panels
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
        cell.mesh.scaling.setAll(1.0);
        this.flagged ++;
      } else {
        cell.mesh.material = cell.material!;
        cell.mesh.scaling.setAll(1.0);
        this.flagged --;
      }
      this.mineCountEl.textContent = String(this.mineCount - this.flagged);
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

      // Add number indicators on the sphere surface as text
      if (cell.neighborMines > 0) {
        // const color = this.textColors[Math.min(cell.neighborMines - 1, this.textColors.length - 1)];

        // Small plane floating just above the patch, oriented to face outward
        const indicator = MeshBuilder.CreatePlane(`ind_${cell.index}`, { size: 0.28 }, this.scene);
        indicator.position = cell.center.scale(2.09);
        indicator.billboardMode = Mesh.BILLBOARDMODE_ALL;

        // lookAt a point further out along the cell normal so the +Z face points outward
        // indicator.lookAt(cell.center.scale(100));
        indicator.parent = this.ballContainer;
        indicator.isPickable = false;
        indicator.material = this.indMaterials[cell.neighborMines - 1];
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

    this.timerInterval = 0;
    this.timeElapsed = 0;

    // Show all mine locations
    this.cells.forEach((cell) => {
      if (cell.isMine && cell.mesh) {
        cell.mesh.material = win ? this.flaggedMat : this.mineMat;
      }
    });

    if (this.endInterval) {
      clearInterval(this.endInterval);
    }

    this.endInterval = setTimeout(() => {
      this.overlayEl!.textContent = win
        ? 'Winner! You swept the ball safely!'
        : 'Red Card! You hit a soccer mine.'
        
      this.overlayEl!.style.display = 'block';
    }, 200);
  }

  private animate() {
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }
}

// Start game
window.addEventListener('DOMContentLoaded', () => {
  new SphericalSweeper('renderCanvas');
});
