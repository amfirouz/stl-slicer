// planeSetup.js

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/Addons.js';

export function createPlanesAndLabels(scene, width, height) {
    // Materials for planes
    const materialXY = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, opacity: 0.3, transparent: true,
        depthWrite: false,  // Avoids writing to the depth buffer for transparency
        depthTest: true     // Ensures proper transparency rendering behind other objects
    });
    const materialXZ = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide, opacity: 0.3, transparent: true,
        depthWrite: false,  // Avoids writing to the depth buffer for transparency
        depthTest: true     // Ensures proper transparency rendering behind other objects
     });
    const materialYZ = new THREE.MeshBasicMaterial({ color: 0x0000ff, side: THREE.DoubleSide, opacity: 0.3, transparent: true,
        depthWrite: false,  // Avoids writing to the depth buffer for transparency
        depthTest: true     // Ensures proper transparency rendering behind other objects
     });

    // Plane geometry
    const planeGeometry = new THREE.PlaneGeometry(width * 2, height * 2);

    // Create the planes
    const planeXY = new THREE.Mesh(planeGeometry, materialXY);
    const planeXZ = new THREE.Mesh(planeGeometry, materialXZ);
    const planeYZ = new THREE.Mesh(planeGeometry, materialYZ);

    // Rotate the planes correctly
    planeXY.rotation.z = 0;               // XY Plane (no rotation needed)
    planeXZ.rotation.x = Math.PI / 2;      // XZ Plane (rotate 90° around X-axis)
    planeYZ.rotation.y = Math.PI / 2;      // YZ Plane (rotate 90° around Y-axis)

    // Position planes correctly (keeping them centered at origin)
    planeXY.position.set(0, 0, 0);
    planeXZ.position.set(0, 0, 0);
    planeYZ.position.set(0, 0, 0);

    // Add planes to the scene
    scene.add(planeXY);
    scene.add(planeXZ);
    scene.add(planeYZ);

    // Function to create labels
    function createLabel(text, position) {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'label';
        labelDiv.style.position = 'absolute';
        labelDiv.style.color = 'white';
        labelDiv.style.fontSize = '20px';
        labelDiv.style.pointerEvents = 'none'; // Ensure labels don't block interactions
        labelDiv.innerText = text;

        const labelObject = new CSS2DObject(labelDiv);
        labelObject.position.set(position.x, position.y, position.z);

        return labelObject;
    }

    // Labels for X, Y, Z axes with proper spacing
    const labelSpacing = 1.5; // Increased spacing for better readability
    const labelX = createLabel('x', new THREE.Vector3(width + labelSpacing, 0, 0));  // Label for X at the edge of XY
    const labelY = createLabel('y', new THREE.Vector3(0, height + labelSpacing, 0)); // Label for Y at the edge of XZ
    const labelZ = createLabel('z', new THREE.Vector3(0, 0, width + labelSpacing));  // Label for Z at the edge of YZ

    // Add the labels to the scene
    scene.add(labelX);
    scene.add(labelY);
    scene.add(labelZ);

    // Return the planes so they can be controlled later (e.g., for visibility toggling)
    return { planeXY, planeXZ, planeYZ };
}
