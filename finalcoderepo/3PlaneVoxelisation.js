// Import Three.js and OrbitControls
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/Addons.js';
import g, { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { CSS2DRenderer } from 'three/examples/jsm/Addons.js';
import { TransformControls } from 'three/examples/jsm/Addons.js';
import { createPlanesAndLabels } from './planesetup.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { FBXLoader } from 'three/examples/jsm/Addons.js';
import JSZip from "jszip";

//#region Setup the scene
// Initialize Stats.js
const stats = new Stats();
document.body.appendChild(stats.dom); // Add the stats panel to the document

// Position the stats panel (default is top left, but can be changed)
stats.dom.style.position = 'absolute';
stats.dom.style.top = '0px';
stats.dom.style.left = '0px';
// Change the size of the stats window
stats.dom.style.transform = 'scale(1.5)'; // Scale up by 1.5x
stats.dom.style.transformOrigin = 'top left'; // Keep the scaling origin at the top-left corner

// Create the scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.up.set(0,0,1);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Set up the CSS2DRenderer for labels
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none'; // Allow interaction with WebGL canvas
document.body.appendChild(labelRenderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

// Add OrbitControls to rotate the scene
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Call createPlanesAndLabels from planeSetup.js to add planes and labels
const width = 10;
const height = 10;
const { planeXY, planeXZ, planeYZ } = createPlanesAndLabels(scene, width, height);
// Create an AxesHelper with a size of 5 (can be adjusted)
const axesHelper = new THREE.AxesHelper(10);
scene.add(axesHelper);

//#endregion

// Load STL file
let instancedMesh;
let dummy, rayCaster, rayCasterIntersects = [];
let voxels = [];
let logs = []; // Array to store previous logs
let lastBoundingBox;
let gizmo;
let loadedMesh = null;
const gridSize = 0.05;
const voxelSize = gridSize;
const threshold = 0.05;
let voxelGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
let voxelMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
THREE.Mesh.prototype.raycast = acceleratedRaycast;
dummy = new THREE.Object3D();
const material = new THREE.MeshLambertMaterial({
    color: 0xff0000, // white color
    side: THREE.DoubleSide, 
    transparent: true, // Allow transparency
    opacity: 1 // Initial opacity
});
// Variables to store original transformation
let originalPosition = new THREE.Vector3();
let originalRotation = new THREE.Euler();
let originalScale = new THREE.Vector3();

// Create a dropdown for selecting the STL file and a button to load it
// Initialize the GUI for controlling the app
const gui = new GUI();

// Available STL files in the dropdown
const files = [
    "/models/stl/heart.stl",
    "/models/stl/heart_reduced.stl",
    "/models/stl/anatomical-heart.stl",
    "/models/stl/Brain_from_MRI.stl",
    "/models/stl/Brain_from_MRI_reduced.stl",
    "/models/stl/low_poly_cat.stl",
    "/models/stl/middle.stl",
    "/models/stl/pelvis_reduced.stl",
    "/models/stl/sample.stl",
    "/models/stl/heart.FBX"
];

// Create a file selector in the GUI
const loadFolder = gui.addFolder('Model Loader');
const modelController = loadFolder.add({ model: files[0] }, 'model', files).name('Select STL File');

// Create the button outside the load function
loadFolder.add({loadModel: () => {
        // Get the selected model from the dropdown and load it
        console.clear();
        logs = [];
        const selectedFile = modelController.getValue();
        loadModelFile(selectedFile).then((data) => {
            // Store the loaded mesh in loadedMesh variable
            loadedMesh = data.mesh;
            originalPosition = data.originalPosition;
            originalRotation = data.originalRotation
            originalScale = data.originalScale;

            // Optionally handle other data (originalPosition, originalRotation, originalScale)
            // For example, you can store these to reset the mesh later if needed.
        }).catch((error) => {
            console.error("Error loading the model:", error);
        });
    }
}, 'loadModel').name('Load Model');

const transformControl = new TransformControls(camera, renderer.domElement);

  //#region Visibility Controls for planes, model and transform controls
planeXZ.visible = false;
planeYZ.visible = false;
const visibilityControl = {
    visible: true,
    XYvisible: true,
    XZvisible: false,
    YZvisible: false
};
const planeFolder = gui.addFolder('Plane Settings');
    planeFolder.add(visibilityControl, 'XYvisible').name('Plane XY').onChange(function () {
    planeXY.visible = visibilityControl.XYvisible;
    if(instancedMesh){
        scheduleVoxelUpdate();
    }
});
planeFolder.add(visibilityControl, 'XZvisible').name('Plane XZ').onChange(function () {
    planeXZ.visible = visibilityControl.XZvisible;
    if(instancedMesh){
        scheduleVoxelUpdate();
    }
});
planeFolder.add(visibilityControl, 'YZvisible').name('Plane YZ').onChange(function () {
    planeYZ.visible = visibilityControl.YZvisible;
    if(instancedMesh){
        scheduleVoxelUpdate();
    }
});
// Add visibility toggle inside another folder
const tFolder = gui.addFolder('Press S,R or T for scale, rotation or translation');
const viewFolder = gui.addFolder('Visibility');
    viewFolder.add(visibilityControl, 'visible').name('Model Visible').onChange(function () {
if (loadedMesh) {
    loadedMesh.visible = visibilityControl.visible;
}
});

// If it's a material that supports transparency (like MeshStandardMaterial), enable it
material.transparent = true;

// Create an object to hold the opacity property
const meshSettings = {
    opacity: material.opacity // Set the initial opacity value
};

// Add the opacity control to the GUI
viewFolder.add(meshSettings, 'opacity', 0, 1, 0.01).name('Model Opacity').onChange((value) => {
    material.opacity = value;
    material.needsUpdate = true; // Refresh the material
});

// Ensure the planes have a transparent material
planeXY.material.transparent = true;
planeXZ.material.transparent = true;
planeYZ.material.transparent = true;

// Create an object to hold opacity values
const planeOpacity = {
    opacity: 0.3 // Initial opacity
};

// Add the opacity control to the GUI
viewFolder.add(planeOpacity, 'opacity', 0, 1, 0.01).name('Plane Opacity').onChange((value) => {
    planeXY.material.opacity = value;
    planeXZ.material.opacity = value;
    planeYZ.material.opacity = value;
    planeXY.material.needsUpdate = true;
    planeXZ.material.needsUpdate = true;
    planeYZ.material.needsUpdate = true;
});

viewFolder.add(visibilityControl, 'visible').name('Controls Visible').onChange(function () {
    gizmo.visible = visibilityControl.visible;
  });

// Disable Trackball_ when Transform_ are active
transformControl.addEventListener('mouseDown', () => {
    controls.enabled = false; // Disable trackball controls
});

transformControl.addEventListener('mouseUp', () => {
    controls.enabled = true; // Re-enable trackball controls
});

// Optional: Disable Trackball_ when Transform_ are hovered
transformControl.addEventListener('hover', (event) => {
    controls.enabled = !event.value; // Disable if hover is true
});

transformControl.addEventListener('objectChange', () => {
    if (transformControl.mode === "scale" && loadedMesh) {
        const avgScale = (loadedMesh.scale.x + loadedMesh.scale.y + loadedMesh.scale.z) / 3;
        loadedMesh.scale.set(avgScale, avgScale, avgScale);
    }
});

// Attach event listener to TransformControls for live updates
transformControl.addEventListener('objectChange', () => {
    // Trigger an update when the mesh is transformed (moved, scaled, rotated)
    scheduleVoxelUpdate();
});

window.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'r': 
            transformControl.setMode("rotate");
            transformControl.showX = true;
            transformControl.showY = true;
            transformControl.showZ = true;
            break;
        case 't': 
            transformControl.setMode("translate");
            transformControl.showX = true;
            transformControl.showY = true;
            transformControl.showZ = true;
            break;
        case 's': 
            transformControl.setMode("scale");
            transformControl.showX = false;
            transformControl.showY = true;
            transformControl.showZ = false;
            break;
    }
});
// GUI Controls
const guiControls = {
resetModel: function () {
    if (loadedMesh) {
        loadedMesh.position.copy(originalPosition);
        loadedMesh.rotation.copy(originalRotation);
        loadedMesh.scale.copy(originalScale);
        if(instancedMesh) {
            scene.remove(instancedMesh);
            instancedMesh.geometry.dispose();
            instancedMesh.material.dispose();
        }
        if (guiControls.liveUpdate) {
            // When live update is enabled, start updating the intersection continuously
            scheduleVoxelUpdate();
        }
        console.log("Model reset to original position");
    }
},
updateSlice: function () {
        console.log("Update button pressed");
        if (!loadedMesh) {
            console.warn("No loaded mesh. Please load a model first.");
            return;
        }
        console.log("Starting voxel update...");
        updateVoxelisation();
    },
liveUpdate: false,
};

// Add Reset Button to GUI
loadFolder.add(guiControls, 'resetModel').name("Reset Model");

const sliceFolder = gui.addFolder("Slice Controls")
sliceFolder.add(guiControls, 'updateSlice').name("Update Slice")


// Create a color swatch menu
const colours = { colour: '#ffffff' };  // Initial color (hex format for GUI compatibility)

sliceFolder.addColor(colours, 'colour').name('Voxel Color').onChange((value) => {
    instancedMesh.material.color.set(value);
});

// Add the checkbox to the GUI for enabling/disabling live updates
sliceFolder.add(guiControls, 'liveUpdate').name('Live Update').onChange(() => {
    if (guiControls.liveUpdate) {
        // When live update is enabled, start updating the intersection continuously
        scheduleVoxelUpdate();
    }
});

let updateTimeout = null;
let updateDelay = 50; // Delay in milliseconds (adjust as needed)
sliceFolder.add({ updateDelay: 50 }, 'updateDelay', 0, 100, 1).name('Update Delay (ms)').onChange((value) => {
    console.log('Update Delay set to: ' + value);
    // Update the global updateDelay variable
    updateDelay = value;  // Directly update the global variable
});

const imageSliceFolder = gui.addFolder("Image Slicer")
let HU = 50;
const scan = [
    'CT',
    'MRI',
    'Ultrasound',
    'PET'
];
const tissue =[
    'Heart', // 50 HU
    'Brain', // 40 HU
    'Muscle', // 30 HU
    'Liver', // 50 HU
    'Lungs', // 40 HU
    'Bone' // 1000 HU
];
const scanType = imageSliceFolder.add({ scan: scan[0] }, 'scan', scan).name('Select Scan Type (Only CT supported)');
const tissueType = imageSliceFolder.add({ tissue: tissue[0] }, 'tissue', tissue).name('Select Tissue Type').onChange((value) => {
    if(scanType.getValue() == 'CT') {
        console.log('This is a CT scan')
        switch(value){
            case "Heart":
                HU = 50;
                console.log('Tissue: Heart')
                break;
            case "Brain":
                HU = 40;
                console.log('Tissue: Brain')
                break;
            case "Muscle":
                HU = 30;
                console.log('Tissue: Brain')
                break;
            case "Liver":
                HU = 50;
                console.log('Tissue: Brain')
                break;
            case "Lungs":
                HU = -600;
                console.log('Tissue: Brain')
                break;
            case "Bone":
                HU = 1000;
                console.log('Tissue: Brain')
                break;
        }
    } else {
        console.log('Only CT scans are supported')
    }
});

if(scanType.getValue() == 'CT') {
    console.log('This is a CT scan')    
} else {
    console.log('Only CT scans are supported')
}
// Define available options for the dropdown
const options = ['XY', 'XZ', 'YZ'];

// Define a container for the selected option
let selectedOption = options[0]; // Default to 'XY'

// Add a dropdown to the GUI
const guiObject = { selectedOption };  // Using an object to bind the dropdown
imageSliceFolder.add(guiObject, 'selectedOption', options).name('Select plane to slice');

// New button for generating binary images from the slice
const actions = {
    showPopup: () => {
        const userResponse = confirm("Create a zip file of slices?");
        if (userResponse) {
            console.log("User clicked YES");
            if (!loadedMesh) {
                console.warn("No loaded mesh. Please load a model first.");
                return;
            }
    
            console.log("Generating binary image from the slice...");
            console.time('Image Stack time: ');
            console.log(guiObject.selectedOption); // Access the value from the bound object
            
            // Call the function to create the binary image based on selectedOption
            if (guiObject.selectedOption == 'XY') {
                createBinaryImagesForSlices(true, false, false);
            }
            if (guiObject.selectedOption == 'XZ') {
                createBinaryImagesForSlices(false, true, false);
            }
            if (guiObject.selectedOption == 'YZ') {
                createBinaryImagesForSlices(false, false, true);
            }
            console.timeEnd('Image Stack time: ');
        } else {
            console.log("User clicked NO");
        }
    }
};
imageSliceFolder.add(actions, 'showPopup').name("Generate Image Slices");

//#region functions
// Function to determine file type and load appropriately
async function loadModelFile(file) {
    const fileExtension = file.split('.').pop().toLowerCase();
    
    if (fileExtension === 'stl') {
        return loadSTLFile(file);
    } else if (fileExtension === 'fbx') {
        return loadFBXFile(file);
    } else {
        throw new Error('Unsupported file format. Only STL and FBX are allowed.');
    }
}

// Create a function to load the selected STL file
function loadSTLFile(fileName) {
    return new Promise((resolve, reject) => {
        const loader = new STLLoader();

        // Remove previous mesh if exists
        if (loadedMesh) {
            scene.remove(loadedMesh);
            transformControl.detach(loadedMesh);
            loadedMesh.geometry.dispose();
            loadedMesh.material.dispose();
        }
        if (instancedMesh) {
            scene.remove(instancedMesh);
            transformControl.detach(instancedMesh);
            instancedMesh.geometry.dispose();
            instancedMesh.material.dispose();
        }

        loader.load(fileName, function (geometry) {
            console.log("STL Geometry Loaded:", geometry);
            // Simplify mesh if needed
            /*
            const faceCount = geometry.attributes.position.count / 3;
            console.log(`Current face count: ${faceCount}`);
            const maxFaces = 50000
            // If the face count exceeds the threshold, simplify the mesh
            if (faceCount > maxFaces) {
                const reductionFactor = maxFaces / faceCount; // Factor to reduce the faces by
                console.log(`Reduction factor: ${reductionFactor}`);
        
                // Ensure the target face count doesn't go below 3 (min number of faces for a mesh)
                const targetCount = Math.floor(faceCount * reductionFactor);
                console.log(`Target face count: ${targetCount}`);
                const modifier = new SimplifyModifier();
                const simplifiedGeometry = modifier.modify(geometry, Math.floor(targetCount * 3));

                // Dispose of the old geometry and assign the new simplified geometry
                geometry.dispose();
                mesh.geometry = simplifiedGeometry;

                console.log(`Mesh simplified to ${simplifiedGeometry.attributes.position.count / 3} faces.`);
            } else {
                console.log('Mesh does not require simplification.');
            }*/

            // Compute bounding box to center the model
            geometry.computeBoundingBox();
            const bbox = geometry.boundingBox;
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);
            console.log("Model Center Position:", center);

            // Compute smooth shading
            geometry.computeVertexNormals();
            let mesh = new THREE.Mesh(geometry, material);

            // Calculate size of the bounding box
            const size = new THREE.Vector3();
            bbox.getSize(size);

            
            // Log the size of the bounding box
            console.log("Bounding Box Size:", size);

            // Find the largest dimension
            const maxDim = Math.max(size.x, size.y, size.z);

            // Desired maximum size across (from -10 to 10)
            const desiredSize = 20;

            // Compute scaling factor
            const scalingFactor = desiredSize / maxDim;

            // Apply scaling
            mesh.rotation.set(0,0,1.57);
            mesh.scale.set(scalingFactor, scalingFactor, scalingFactor);

            // Now compute the scaled bounding box
            const scaledBox = new THREE.Box3().setFromObject(mesh);
            const scaledSize = new THREE.Vector3();
            scaledBox.getSize(scaledSize);

            // Log the scaled size
            console.log("Scaled Bounding Box Size:", scaledSize);

            // Store original transformation values
            originalPosition = mesh.position.clone();
            originalRotation = mesh.rotation.clone();
            originalScale = mesh.scale.clone();

            // Add the new mesh to the scene
            scene.add(mesh);
            console.log("Mesh successfully added to the scene:", mesh);
            transformControl.attach(mesh);
            transformControl.setMode("rotate");

            gizmo = transformControl.getHelper();
            scene.add(gizmo);

            // Resolve the promise with relevant data
            resolve({ mesh, originalPosition, originalRotation, originalScale });
        },
        undefined, // Progress callback (optional)
        function (error) {
            console.error("Error loading STL file:", error);
            reject(error);
        });
    });
}


// Optimised voxelisation with plane slicing
function voxeliseMesh(mesh, gridSize = 0.1, threshold = 0.1, XY = true, XZ = false, YZ = false,series = false) {
    if (!mesh || !mesh.geometry) {
        console.warn('No mesh loaded.');
        return;
    }

    const bvh = new MeshBVH(mesh.geometry);
    mesh.geometry.boundsTree = bvh;
    
    const boundingBox = new THREE.Box3().setFromObject(mesh);
    const minX = boundingBox.min.x, maxX = boundingBox.max.x;
    const minY = boundingBox.min.y, maxY = boundingBox.max.y;
    const minZ = boundingBox.min.z, maxZ = boundingBox.max.z;
    
    console.clear();
    console.time("Voxelisation time:");
    voxels = []; // Reset the voxel list
    let count = 0;
    let count_total = 0;
    let totalVoxels = Math.ceil((maxX - minX) / gridSize) * Math.ceil((maxY - minY) / gridSize) * Math.ceil((maxZ - minZ) / gridSize);
    console.log(`Total voxels in slice: ${totalVoxels}`);
    
    if (!series) {
        if (XY){
            for (let x = minX; x < maxX; x += gridSize) {
                    const origin = new THREE.Vector3(x + gridSize/2, minY-1, 0 + gridSize / 2); // start ray below
                    const direction = new THREE.Vector3(0, 1, 0); // z-direction
                    const raycaster = new THREE.Raycaster(origin, direction);
                    raycaster.firstHitOnly = false;

                    const intersections = raycaster.intersectObject(mesh, false);

                    if (intersections.length >= 2) {
                        // Sort intersections by Z (distance along ray)
                        intersections.sort((a, b) => a.point.y - b.point.y);

                        for (let i = 0; i < intersections.length - 1; i += 2) {
                            const yStart = intersections[i].point.y;
                            const yEnd = intersections[i + 1].point.y;

                            for (let y = yStart; y < yEnd; y += gridSize) {
                                const voxelPos = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, 0);
                                voxels.push({ position: voxelPos });
                                count++;
                            }
                        }
                    }
                    count_total++;
            }
        }

        if (XZ){
            for (let x = minX; x < maxX; x += gridSize) {
                const origin = new THREE.Vector3(x + gridSize/2,0+gridSize/2,minZ-1); // start ray below
                const direction = new THREE.Vector3(0, 0, 1); // z-direction
                const raycaster = new THREE.Raycaster(origin, direction);
                raycaster.firstHitOnly = false;

                const intersections = raycaster.intersectObject(mesh, false);

                if (intersections.length >= 2) {
                    // Sort intersections by Z (distance along ray)
                    intersections.sort((a, b) => a.point.z - b.point.z);

                    for (let i = 0; i < intersections.length - 1; i += 2) {
                        const zStart = intersections[i].point.z;
                        const zEnd = intersections[i + 1].point.z;

                        for (let z = zStart; z < zEnd; z += gridSize) {
                            const voxelPos = new THREE.Vector3(x+gridSize / 2,0, z + gridSize / 2);
                            voxels.push({ position: voxelPos });
                            count++;
                        }
                    }
                }
                count_total++;
            }
        }

        if (YZ){
                for (let y = minY; y < maxY; y += gridSize) {
                    const origin = new THREE.Vector3(0, y + gridSize / 2,minZ); // start ray below
                    const direction = new THREE.Vector3(0, 0, 1); // z-direction
                    const raycaster = new THREE.Raycaster(origin, direction);
                    raycaster.firstHitOnly = false;
    
                    const intersections = raycaster.intersectObject(mesh, false);
    
                    if (intersections.length >= 2) {
                        // Sort intersections by Z (distance along ray)
                        intersections.sort((a, b) => a.point.z - b.point.z);
    
                        for (let i = 0; i < intersections.length - 1; i += 2) {
                            const zStart = intersections[i].point.z;
                            const zEnd = intersections[i + 1].point.z;
    
                            for (let z = zStart; z < zEnd; z += gridSize) {
                                const voxelPos = new THREE.Vector3(0, y + gridSize / 2, z + gridSize / 2);
                                voxels.push({ position: voxelPos });
                                count++;
                            }
                        }
                    }
                    count_total++;
                }
            }
        }
    if (series) {
        for (let x = minX; x < maxX; x += gridSize) {
            for (let y = minY; y < maxY; y += gridSize) {
                const origin = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, minZ - 1); // start ray below
                const direction = new THREE.Vector3(0, 0, 1); // z-direction
                const raycaster = new THREE.Raycaster(origin, direction);
                raycaster.firstHitOnly = false;

                const intersections = raycaster.intersectObject(mesh, false);

                if (intersections.length >= 2) {
                    // Sort intersections by Z (distance along ray)
                    intersections.sort((a, b) => a.point.z - b.point.z);

                    for (let i = 0; i < intersections.length - 1; i += 2) {
                        const zStart = intersections[i].point.z;
                        const zEnd = intersections[i + 1].point.z;

                        for (let z = zStart; z < zEnd; z += gridSize) {
                            const voxelPos = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, z + gridSize / 2);
                            voxels.push({ position: voxelPos });
                            count++;
                        }
                    }
                }
                count_total++;
            }
        }
    }
    console.log(`Voxelisation complete. Total voxels placed: ${count}/${count_total}`);
    console.timeEnd("Voxelisation time:");
    logs.forEach(log => console.log(log));
}

function recreateVoxels() {
    for (let i = 0; i < voxels.length; i++) {
        dummy.position.copy(voxels[i].position);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
}

// Function to update voxelisation
function updateVoxelisation() {
    // Remove existing instanced mesh before updating
    if (instancedMesh) {
        scene.remove(instancedMesh);
    }

    voxeliseMesh(loadedMesh, gridSize, threshold,planeXY.visible,planeXZ.visible,planeYZ.visible);

    instancedMesh = new THREE.InstancedMesh(voxelGeometry, voxelMaterial, voxels.length);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;
    scene.add(instancedMesh);
    recreateVoxels();
}

// Debounced update function
function scheduleVoxelUpdate() {
    if (!guiControls.liveUpdate) return;
    
    clearTimeout(updateTimeout); // Cancel previous update
    updateTimeout = setTimeout(updateVoxelisation, updateDelay);
}

function createBinaryImagesForSlices(XY, XZ, YZ) {
    if (!loadedMesh) {
        console.warn("No loaded mesh.");
        return;
    }

    let zip = new JSZip();
    const width = 1024;
    const height = 1024;
    const padding = 50;

    const bvh = new MeshBVH(loadedMesh.geometry);
    loadedMesh.geometry.boundsTree = bvh;

    const boundingBox = new THREE.Box3().setFromObject(loadedMesh);
    const minX = boundingBox.min.x;
    const minY = boundingBox.min.y;
    const minZ = boundingBox.min.z;
    const maxX = boundingBox.max.x;
    const maxY = boundingBox.max.y;
    const maxZ = boundingBox.max.z;

    console.log(`Bounding box dimensions:`);
    console.log(`minX: ${minX}, minY: ${minY}, minZ: ${minZ}`);
    console.log(`maxX: ${maxX}, maxY: ${maxY}, maxZ: ${maxZ}`);

    const numVoxelsX = Math.floor((maxX - minX) / gridSize);
    const numVoxelsY = Math.floor((maxY - minY) / gridSize);
    const numVoxelsZ = Math.floor((maxZ - minZ) / gridSize);

    console.log(`Voxel grid size: ${numVoxelsX} x ${numVoxelsY} x ${numVoxelsZ}`);
    console.log(`Grid size (in units): ${gridSize}`);

    const scaleX = (width - 2 * padding) / numVoxelsX;
    const scaleY = (height - 2 * padding) / numVoxelsY;
    const scale = Math.min(scaleX, scaleY);
    console.log('scale', scale);

    let count = 0;
    let iMin, iMax, sliceAxis;
    
    if (XY) {
        iMin = minZ;
        iMax = maxZ;
        sliceAxis = 'z';
    }
    if (XZ) {
        iMin = minY;
        iMax = maxY;
        sliceAxis = 'y';
    }
    if (YZ) {
        iMin = minX;
        iMax = maxX;
        sliceAxis = 'x';
    }

    console.log(`Slice Axis: ${sliceAxis}`);
    console.log(`Slice range: ${iMin} to ${iMax}`);

    // Function to add Gaussian noise
    function addGaussianNoise(value, mean = 0, stdDev = 30) {
        let noise = Math.random() * stdDev + mean;
        noise = Math.max(0, Math.min(255, value + noise)); // Keep within valid range
        return Math.floor(noise);
    }
    let slice_counter = 0;
    const numSlices = 100;
    for (let s = 0; s < numSlices; s++) {
        const t = s / (numSlices - 1);
        const i = iMin + t * (iMax - iMin);
        console.log(`Processing slice at ${sliceAxis} = ${i}`);
        slice_counter++;
        console.log(slice_counter);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = width;
        canvas.height = height;

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);

        // Raycasting along the slice axis
        if (XY) {
            for (let x = minX; x < maxX; x += gridSize) {
                const y = minY-1;
                const z = i;
                const origin = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, z + gridSize / 2);
                const direction = new THREE.Vector3(0, 1, 0); // Z-axis direction
                const raycaster = new THREE.Raycaster(origin, direction);
                raycaster.firstHitOnly = false;

                const intersections = raycaster.intersectObject(loadedMesh, false);

                if (intersections.length >= 2) {
                    // Sort intersections along Y-axis
                    intersections.sort((a, b) => a.point.y - b.point.y);

                    for (let j = 0; j < intersections.length - 1; j += 2) {
                        const yStart = snapToGrid(intersections[j].point.y, gridSize);
                        const yEnd = snapToGrid(intersections[j + 1].point.y, gridSize);

                        for (let y = yStart; y < yEnd; y += gridSize) {
                            const voxelPos = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, z + gridSize / 2);
                            const voxelX = (voxelPos.x - minX) / gridSize * scale + padding;
                            const voxelY = (voxelPos.y - minY) / gridSize * scale + padding;

                            // Apply Gaussian noise to grayscale intensity
                            const noisyValue = addGaussianNoise(HU, 0, 50);
                            ctx.fillStyle = `rgb(${noisyValue},${noisyValue},${noisyValue})`;
                            ctx.fillRect(voxelY, voxelX, scale + 1, scale + 1);
                        }
                    }
                }
            }
        }

        if (XZ) {
            for (let x = minX; x < maxX; x += gridSize) {
                const y = i;
                const z = minZ-1;
                const origin = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, z + gridSize / 2);
                const direction = new THREE.Vector3(0, 0, 1); // Z-axis direction
                const raycaster = new THREE.Raycaster(origin, direction);
                raycaster.firstHitOnly = false;

                const intersections = raycaster.intersectObject(loadedMesh, false);

                if (intersections.length >= 2) {
                    // Sort intersections along Y-axis
                    intersections.sort((a, b) => a.point.z - b.point.z);

                    for (let j = 0; j < intersections.length - 1; j += 2) {
                        const zStart = snapToGrid(intersections[j].point.z, gridSize);
                        const zEnd = snapToGrid(intersections[j + 1].point.z, gridSize);

                        for (let z = zStart; z < zEnd; z += gridSize) {
                            const voxelPos = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, z + gridSize / 2);
                            const voxelX = (-voxelPos.x - minX) / gridSize * scale + padding;
                            const voxelZ = (-voxelPos.z - minZ) / gridSize * scale + padding;

                            // Apply Gaussian noise to grayscale intensity
                            const noisyValue = addGaussianNoise(HU, 0, 50);
                            ctx.fillStyle = `rgb(${noisyValue},${noisyValue},${noisyValue})`;
                            ctx.fillRect(voxelX, voxelZ, scale + 1, scale + 1);
                        }
                    }
                }
            }
        }

        if (YZ) {
            for (let y = minX; y < maxX; y += gridSize) {
                const x = i;
                const z = minZ-1;
                const origin = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, z + gridSize / 2);
                const direction = new THREE.Vector3(0, 0, 1); // Z-axis direction
                const raycaster = new THREE.Raycaster(origin, direction);
                raycaster.firstHitOnly = false;

                const intersections = raycaster.intersectObject(loadedMesh, false);

                if (intersections.length >= 2) {
                    // Sort intersections along Y-axis
                    intersections.sort((a, b) => a.point.z - b.point.z);

                    for (let j = 0; j < intersections.length - 1; j += 2) {
                        const zStart = snapToGrid(intersections[j].point.z, gridSize);
                        const zEnd = snapToGrid(intersections[j + 1].point.z, gridSize);

                        for (let z = zStart; z < zEnd; z += gridSize) {
                            const voxelPos = new THREE.Vector3(x + gridSize / 2, y + gridSize / 2, z + gridSize / 2);
                            const voxelY = (voxelPos.y - minY) / gridSize * scale + padding;
                            const voxelZ = (-voxelPos.z - minZ) / gridSize * scale + padding;

                            // Apply Gaussian noise to grayscale intensity
                            const noisyValue = addGaussianNoise(HU, 0, 50);
                            ctx.fillStyle = `rgb(${noisyValue},${noisyValue},${noisyValue})`;
                            ctx.fillRect(voxelY, voxelZ, scale + 1, scale + 1);
                        }
                    }
                }
            }
        }

        zip.file(`slice_${sliceAxis}_${count}.png`, canvas.toDataURL('image/png').split(',')[1], { base64: true });
        count++;
    }

    zip.generateAsync({ type: "blob" }).then(function (content) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'slices.zip';
        link.click();
        console.log("ZIP file with binary images generated and download started.");
    });
}   

function snapToGrid(value, gridSize) {
    return Math.floor(value / gridSize) * gridSize;
}

// Utility function to log and store messages and variables
function logAndStore(...args) {
    console.log(...args);  // Log the messsage/variables to the console (same behavior as console.log)
    logs.push(args); // Store the message/variables in the logs array
}
//#endregion

// Position the camera
camera.position.set(3, 3, 5);
camera.lookAt(scene.position);

// Render loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);  // Render CSS2D labels
    stats.update();  // This updates the performance stats
}
animate();

// Handle window resize
window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);  // Adjust label renderer size
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});
