// ============================================
// PLAYCANVAS 3D DRIVING GAME
// ============================================

var app, carEntity, cameraEntity;
var gameRunning = false;
var carSpeed = 0;
var maxSpeed = 120;
var acceleration = 40;
var braking = 60;
var naturalDecel = 15;
var turnSpeed = 120;
var carRotation = 0;
var driftActive = false;
var driftMultiplier = 1.0;
var keys = {};
var trafficLights = [];
var aiCars = [];
var currentLightState = 'green';
var lightTimer = 0;
var lightChangeInterval = 5;
var cameraMode = 0;
var gameState = 'menu';

var modelCache = {};
var buildingAssets = [];
var propAssets = {};
var playerCarAsset = null;
var aiCarAsset = null;
var selectedCarType = null;
var dirtyCarAsset = null;
var flyingCarAsset = null;

// ============================================
// GLB MODEL LOADER
// ============================================
function loadGLB(url, callback) {
    var filename = url.split('/').pop();
    var timeoutId = setTimeout(function () {
        console.warn('GLB load timeout for', url);
        callback(null);
    }, 30000);

    try {
        app.assets.loadFromUrlAndFilename(url, filename, 'container', function (err, asset) {
            clearTimeout(timeoutId);
            if (err) {
                console.warn('GLB load error for', url, ':', err);
                callback(null);
                return;
            }
            if (!asset) {
                console.warn('GLB no asset for', url);
                callback(null);
                return;
            }
            if (!asset.resource) {
                console.warn('GLB no resource for', url, '- asset.loaded:', asset.loaded);
                callback(null);
                return;
            }
            console.log('GLB loaded OK:', url, '- resource type:', typeof asset.resource);
            callback(asset);
        });
    } catch (e) {
        clearTimeout(timeoutId);
        console.warn('GLB load exception for', url, ':', e.message);
        callback(null);
    }
}

function instantiateModel(asset, parent, x, y, z, sx, sy, sz, rx, ry, rz) {
    try {
        var entity = asset.resource.instantiateRenderEntity();
        if (sx !== undefined) {
            entity.setLocalScale(sx, sy !== undefined ? sy : sx, sz !== undefined ? sz : sx);
        }
        if (x !== undefined) entity.setPosition(x, y || 0, z || 0);
        if (rx !== undefined) entity.setLocalEulerAngles(rx, ry || 0, rz || 0);
        if (parent) parent.addChild(entity);
        else app.root.addChild(entity);
        return entity;
    } catch (e) {
        console.warn('instantiateModel failed:', e.message);
        return null;
    }
}

function loadMultipleGLB(urls, onAllLoaded) {
    var loaded = 0;
    var total = urls.length;
    var results = {};
    urls.forEach(function (url) {
        loadGLB(url, function (asset) {
            results[url] = asset;
            loaded++;
            if (loaded >= total) onAllLoaded(results);
        });
    });
}

// ============================================
// ENGINE INIT
// ============================================
function initEngine() {
    var canvas = document.getElementById('gameCanvas');

    app = new pc.Application(canvas, {
        mouse: new pc.Mouse(canvas),
        keyboard: new pc.Keyboard(window)
    });

    try { app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW); } catch (e) { }
    try { app.setCanvasResolution(pc.RESOLUTION_AUTO); } catch (e) { }

    try {
        app.scene.fog = 'linear';
        app.scene.fogStart = 80;
        app.scene.fogEnd = 250;
        app.scene.fogColor = new pc.Color(0.6, 0.75, 0.95);
    } catch (e) {
        console.log('Fog setup skipped:', e.message);
    }

    createLighting();

    cameraEntity = new pc.Entity('camera');
    cameraEntity.addComponent('camera', {
        fov: 65,
        nearClip: 0.1,
        farClip: 500,
        clearColor: new pc.Color(0.6, 0.75, 0.95)
    });
    cameraEntity.setPosition(0, 10, 20);
    app.root.addChild(cameraEntity);

    setupInput();
    setupMenuButtons();

    window.addEventListener('resize', function () { app.resizeCanvas(); });
    document.getElementById('start-stop-btn').addEventListener('click', toggleGame);

    app.on('update', function (dt) {
        if (gameState !== 'playing') return;
        updateTrafficLightState(dt);
        updateCarPhysics(dt);
        updateCamera(dt);
        updateAI(dt);
        updateUI();
    });

    app.start();
}

// ============================================
// MENU
// ============================================
function setupMenuButtons() {
    document.getElementById('btn-start-game').addEventListener('click', startLoading);
    document.getElementById('btn-controls').addEventListener('click', function () {
        document.getElementById('controls-panel').classList.remove('hidden');
    });
    document.getElementById('btn-controls-back').addEventListener('click', function () {
        document.getElementById('controls-panel').classList.add('hidden');
    });
}

function startLoading() {
    gameState = 'loading';
    var menuScreen = document.getElementById('menu-screen');
    menuScreen.classList.add('fade-out');

    setTimeout(function () {
        menuScreen.classList.add('hidden');
        document.getElementById('loading-screen').classList.remove('hidden');
        preloadAssets();
    }, 600);
}

// ============================================
// ASSET PRELOADING
// ============================================
function preloadAssets() {
    var buildingFiles = [
        'models/buildings/commercial/building-a.glb',
        'models/buildings/commercial/building-b.glb',
        'models/buildings/commercial/building-c.glb',
        'models/buildings/commercial/building-d.glb',
        'models/buildings/commercial/building-e.glb',
        'models/buildings/commercial/building-f.glb',
        'models/buildings/commercial/building-g.glb',
        'models/buildings/commercial/building-skyscraper-a.glb',
        'models/buildings/commercial/building-skyscraper-b.glb',
        'models/buildings/commercial/building-skyscraper-c.glb',
        'models/buildings/commercial/building-skyscraper-d.glb',
        'models/buildings/commercial/building-skyscraper-e.glb',
        'models/buildings/suburban/suburban-a.glb',
        'models/buildings/suburban/suburban-b.glb',
        'models/buildings/suburban/suburban-c.glb',
        'models/buildings/industrial/industrial-a.glb',
        'models/buildings/industrial/industrial-b.glb'
    ];

    var propFiles = {
        tree1: 'models/props/tree-large.glb',
        tree2: 'models/props/tree-small.glb',
        light1: 'models/props/light-curved.glb',
        light2: 'models/props/light-square.glb',
        fence: 'models/props/fence.glb',
        cone: 'models/props/construction-cone.glb',
        planter: 'models/props/planter.glb',
        sign: 'models/props/sign-highway.glb'
    };

    var allUrls = buildingFiles.slice();
    Object.values(propFiles).forEach(function (u) { allUrls.push(u); });
    allUrls.push('low_poly_cars_pack.glb');
    allUrls.push('low_poly_cars_pack.glb');
    allUrls.push('city_3d_model.glb');
    allUrls.push('models/dirty_car_061220.glb');
    allUrls.push('models/flying_car.glb');

    var totalAssets = allUrls.length;
    var loaded = 0;

    function onAssetLoaded(url, asset) {
        loaded++;
        var pct = Math.round((loaded / totalAssets) * 100);
        document.getElementById('loading-bar').style.width = pct + '%';
        document.getElementById('loading-percent').textContent = pct + '%';
        document.getElementById('loading-text').textContent = 'Loading ' + url.split('/').pop() + '...';
        document.getElementById('loading-asset-count').textContent = loaded + ' / ' + totalAssets;

        if (buildingFiles.indexOf(url) >= 0 && asset) {
            buildingAssets.push(asset);
        }
        Object.keys(propFiles).forEach(function (key) {
            if (propFiles[key] === url && asset) {
                propAssets[key] = asset;
            }
        });
        if (url === 'low_poly_cars_pack.glb' && asset) aiCarAsset = asset;
        if (url === 'city_3d_model.glb' && asset) cityAsset = asset;
        if (url === 'models/dirty_car_061220.glb' && asset) dirtyCarAsset = asset;
        if (url === 'models/flying_car.glb' && asset) flyingCarAsset = asset;

        if (loaded >= totalAssets) {
            onAllAssetsLoaded();
        }
    }

    allUrls.forEach(function (url) {
        loadGLB(url, function (asset) {
            onAssetLoaded(url, asset);
        });
    });
}

function onAllAssetsLoaded() {
    var loadedCount = buildingAssets.length;
    var propCount = Object.keys(propAssets).length;
    console.log('Assets loaded - Buildings:', loadedCount, 'Props:', propCount,
        'AI car:', !!aiCarAsset, 'City model:', !!cityAsset);

    document.getElementById('loading-text').textContent = 'Ready!';
    document.getElementById('loading-bar').style.width = '100%';
    document.getElementById('loading-percent').textContent = '100%';
    setTimeout(function () {
        showCarSelection();
    }, 300);
}

// ============================================
// BUILD WORLD
// ============================================
function buildWorld() {
    document.getElementById('loading-bar').style.width = '100%';
    document.getElementById('loading-percent').textContent = '100%';
    document.getElementById('loading-text').textContent = 'Ready!';

    createGround();
    createRoads();
    createBuildings();
    createProps();
    createPlayerCar();

    setTimeout(function () {
        var ls = document.getElementById('loading-screen');
        ls.classList.add('fade-out');
        setTimeout(function () {
            ls.classList.add('hidden');
            document.getElementById('game-hud').classList.remove('hidden');
            gameState = 'playing';
        }, 800);
    }, 400);
}

// ============================================
// MATERIAL
// ============================================
function createMaterial(color, roughness) {
    var mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255);
    mat.roughness = roughness || 0.7;
    mat.update();
    return mat;
}

// ============================================
// LIGHTING
// ============================================
function createLighting() {
    var ambient = new pc.Entity('ambient');
    ambient.addComponent('light', { type: 'directional', color: new pc.Color(0.4, 0.4, 0.5), intensity: 0.6 });
    ambient.setLocalEulerAngles(45, 30, 0);
    app.root.addChild(ambient);

    var sun = new pc.Entity('sun');
    sun.addComponent('light', {
        type: 'directional', color: new pc.Color(1, 0.95, 0.8), intensity: 1.2,
        castShadows: true, shadowDistance: 150, shadowResolution: 2048, shadowBias: 0.01
    });
    sun.setLocalEulerAngles(60, 45, 0);
    app.root.addChild(sun);

    var hemi = new pc.Entity('hemi');
    hemi.addComponent('light', { type: 'directional', color: new pc.Color(0.5, 0.7, 1), intensity: 0.3 });
    hemi.setLocalEulerAngles(-30, 0, 0);
    app.root.addChild(hemi);
}

// ============================================
// GROUND
// ============================================
function createGround() {
    var ground = new pc.Entity('ground');
    ground.addComponent('model', { type: 'plane', material: createMaterial(0x2d5a1e, 0.9) });
    ground.setLocalScale(600, 1, 600);
    app.root.addChild(ground);
}

// ============================================
// CITY GRID
// ============================================
var cityGrid = {
    roadWidth: 14, blockSize: 70, gridCount: 5,
    getIntersections: function () {
        var p = [], off = (this.gridCount - 1) * this.blockSize / 2;
        for (var gx = 0; gx < this.gridCount; gx++)
            for (var gz = 0; gz < this.gridCount; gz++)
                p.push({ x: gx * this.blockSize - off, z: gz * this.blockSize - off });
        return p;
    }
};

// ============================================
// ROADS
// ============================================
function createRoads() {
    var g = cityGrid.gridCount, bs = cityGrid.blockSize, rw = cityGrid.roadWidth;
    var off = (g - 1) * bs / 2;
    var roadMat = createMaterial(0x333333, 0.95);
    var markMat = createMaterial(0xffffff, 0.5);

    for (var i = 0; i < g; i++) {
        makePlane(0, 0.02, i * bs - off, g * bs, rw, roadMat);
        makePlane(i * bs - off, 0.02, 0, rw, g * bs, roadMat);
    }

    for (var i = 0; i < g; i++) {
        var z = i * bs - off, x = i * bs - off, len = g * bs;
        for (var mx = -len / 2; mx < len / 2; mx += 6) {
            makePlane(mx, 0.03, z, 3, 0.3, markMat);
            makePlane(x, 0.03, mx, 0.3, 3, markMat);
        }
    }
}

function makePlane(x, y, z, sx, sz, mat) {
    var e = new pc.Entity();
    e.addComponent('model', { type: 'plane', material: mat });
    e.setLocalScale(sx, 1, sz);
    e.setPosition(x, y, z);
    app.root.addChild(e);
}

// ============================================
// BUILDINGS
// ============================================
function createBuildings() {
    var g = cityGrid.gridCount, bs = cityGrid.blockSize, rw = cityGrid.roadWidth;
    var off = (g - 1) * bs / 2;

    for (var bx = 0; bx < g - 1; bx++) {
        for (var bz = 0; bz < g - 1; bz++) {
            var cx = (bx + 0.5) * bs - off;
            var cz = (bz + 0.5) * bs - off;

            var count = Math.floor(Math.random() * 4) + 2;
            for (var b = 0; b < count; b++) {
                if (buildingAssets.length > 0) {
                    var asset = buildingAssets[Math.floor(Math.random() * buildingAssets.length)];
                    var scale = 6 + Math.random() * 12;
                    var ry = Math.floor(Math.random() * 4) * 90;
                    var maxOffset = (bs - rw) / 2 - scale / 2 - 2;
                    var px = cx + (Math.random() * 2 - 1) * Math.max(maxOffset, 5);
                    var pz = cz + (Math.random() * 2 - 1) * Math.max(maxOffset, 5);
                    var ent = instantiateModel(asset, null, px, 0, pz, scale, scale, scale, 0, ry, 0);
                    if (!ent) createFallbackBuilding(px, pz);
                } else {
                    var px = cx + (Math.random() - 0.5) * (bs - rw - 10);
                    var pz = cz + (Math.random() - 0.5) * (bs - rw - 10);
                    createFallbackBuilding(px, pz);
                }
            }
        }
    }
}

function createFallbackBuilding(px, pz) {
    var colors = [0x8899aa, 0x998877, 0x7788aa, 0xaa9988, 0x888888, 0x667788, 0x998866, 0x7799aa];
    var h = 8 + Math.random() * 40;
    var w = 5 + Math.random() * 12;
    var d = 5 + Math.random() * 12;

    var bldg = new pc.Entity();
    bldg.addComponent('model', { type: 'box', material: createMaterial(colors[Math.floor(Math.random() * colors.length)], 0.75) });
    bldg.setLocalScale(w, h, d);
    bldg.setPosition(px, h / 2, pz);
    app.root.addChild(bldg);

    var winMat = createMaterial(0xffffcc, 0.3);
    for (var wy = 2; wy < h - 2; wy += 3) {
        for (var wx = -w / 2 + 2; wx < w / 2 - 1; wx += 3) {
            var win = new pc.Entity();
            win.addComponent('model', { type: 'box', material: winMat });
            win.setLocalScale(1.2, 1.2, 0.1);
            win.setPosition(px + wx, wy, pz + d / 2 + 0.06);
            app.root.addChild(win);
        }
    }
}

// ============================================
// PROPS
// ============================================
function createProps() {
    var g = cityGrid.gridCount, bs = cityGrid.blockSize, rw = cityGrid.roadWidth;
    var off = (g - 1) * bs / 2;

    for (var bx = 0; bx < g - 1; bx++) {
        for (var bz = 0; bz < g - 1; bz++) {
            var cx = (bx + 0.5) * bs - off;
            var cz = (bz + 0.5) * bs - off;

            var propCount = Math.floor(Math.random() * 5) + 3;
            for (var p = 0; p < propCount; p++) {
                var px = cx + (Math.random() - 0.5) * 40;
                var pz = cz + (Math.random() - 0.5) * 40;
                var type = Math.floor(Math.random() * 5);

                if (type === 0) {
                    if (propAssets.tree1) {
                        var s = 3 + Math.random() * 3;
                        instantiateModel(propAssets.tree1, null, px, 0, pz, s, s, s, 0, Math.random() * 360, 0);
                    } else if (propAssets.tree2) {
                        var s = 2 + Math.random() * 2;
                        instantiateModel(propAssets.tree2, null, px, 0, pz, s, s, s, 0, Math.random() * 360, 0);
                    } else {
                        createFallbackTree(px, pz);
                    }
                } else if (type === 1) {
                    if (propAssets.light1) {
                        instantiateModel(propAssets.light1, null, px, 0, pz, 1.5, 1.5, 1.5, 0, Math.random() * 360, 0);
                    } else if (propAssets.light2) {
                        instantiateModel(propAssets.light2, null, px, 0, pz, 1.5, 1.5, 1.5, 0, Math.random() * 360, 0);
                    } else {
                        createFallbackLamp(px, pz);
                    }
                } else if (type === 2) {
                    if (propAssets.fence) {
                        instantiateModel(propAssets.fence, null, px, 0, pz, 2, 2, 2, 0, Math.random() * 360, 0);
                    } else {
                        createFallbackBench(px, pz);
                    }
                } else if (type === 3) {
                    if (propAssets.cone) {
                        instantiateModel(propAssets.cone, null, px, 0, pz, 1.5, 1.5, 1.5, 0, 0, 0);
                    }
                } else {
                    if (propAssets.planter) {
                        instantiateModel(propAssets.planter, null, px, 0, pz, 2, 2, 2, 0, Math.random() * 360, 0);
                    } else {
                        createFallbackBench(px, pz);
                    }
                }
            }
        }
    }
}

function createFallbackTree(px, pz) {
    var trunkMat = createMaterial(0x4a3520, 0.9);
    var leafMat = createMaterial(0x1a7a1a, 0.8);
    var trunk = new pc.Entity();
    trunk.addComponent('model', { type: 'cylinder', material: trunkMat });
    trunk.setLocalScale(0.5, 3, 0.5);
    trunk.setPosition(px, 1.5, pz);
    app.root.addChild(trunk);
    var leaves = new pc.Entity();
    leaves.addComponent('model', { type: 'sphere', material: leafMat });
    leaves.setLocalScale(3, 3, 3);
    leaves.setPosition(px, 4, pz);
    app.root.addChild(leaves);
}

function createFallbackLamp(px, pz) {
    var poleMat = createMaterial(0x444444, 0.7);
    var lampMat = createMaterial(0xffff99, 0.2);
    var pole = new pc.Entity();
    pole.addComponent('model', { type: 'cylinder', material: poleMat });
    pole.setLocalScale(0.2, 5, 0.2);
    pole.setPosition(px, 2.5, pz);
    app.root.addChild(pole);
    var lamp = new pc.Entity();
    lamp.addComponent('model', { type: 'sphere', material: lampMat });
    lamp.setLocalScale(0.8, 0.5, 0.8);
    lamp.setPosition(px, 5.2, pz);
    app.root.addChild(lamp);
}

function createFallbackBench(px, pz) {
    var bench = new pc.Entity();
    bench.addComponent('model', { type: 'box', material: createMaterial(0x6b4226, 0.8) });
    bench.setLocalScale(2, 0.5, 0.8);
    bench.setPosition(px, 0.5, pz);
    app.root.addChild(bench);
}

// ============================================
// TRAFFIC LIGHTS
// ============================================
function createTrafficLightSystem() {
    var intersections = cityGrid.getIntersections();
    intersections.forEach(function (pos, index) {
        if (index % 2 === 0) {
            createTrafficLightPole(pos.x + cityGrid.roadWidth / 2 + 1.5, pos.z + cityGrid.roadWidth / 2 + 1.5, 0);
            createTrafficLightPole(pos.x - cityGrid.roadWidth / 2 - 1.5, pos.z - cityGrid.roadWidth / 2 - 1.5, 180);
        }
    });
}

function createTrafficLightPole(x, z, rot) {
    var poleMat = createMaterial(0x222222, 0.6);
    var pole = new pc.Entity();
    pole.addComponent('model', { type: 'cylinder', material: poleMat });
    pole.setLocalScale(0.25, 5, 0.25);
    pole.setPosition(x, 2.5, z);
    app.root.addChild(pole);

    var housing = new pc.Entity();
    housing.addComponent('model', { type: 'box', material: createMaterial(0x111111, 0.5) });
    housing.setLocalScale(1, 3, 0.6);
    housing.setPosition(x, 5.5, z);
    housing.setLocalEulerAngles(0, rot, 0);
    app.root.addChild(housing);

    var redMat = createMaterial(0x330000, 0.4);
    var redLight = new pc.Entity();
    redLight.addComponent('model', { type: 'sphere', material: redMat });
    redLight.setLocalScale(0.6, 0.6, 0.3);
    redLight.setPosition(x, 6.5, z + 0.35);
    app.root.addChild(redLight);

    var yellowMat = createMaterial(0x333300, 0.4);
    var yellowLight = new pc.Entity();
    yellowLight.addComponent('model', { type: 'sphere', material: yellowMat });
    yellowLight.setLocalScale(0.6, 0.6, 0.3);
    yellowLight.setPosition(x, 5.5, z + 0.35);
    app.root.addChild(yellowLight);

    var greenMat = createMaterial(0x003300, 0.4);
    var greenLight = new pc.Entity();
    greenLight.addComponent('model', { type: 'sphere', material: greenMat });
    greenLight.setLocalScale(0.6, 0.6, 0.3);
    greenLight.setPosition(x, 4.5, z + 0.35);
    app.root.addChild(greenLight);

    trafficLights.push({
        position: { x: x, z: z },
        red: { entity: redLight, material: redMat, onMat: createMaterial(0xff0000, 0.2) },
        yellow: { entity: yellowLight, material: yellowMat, onMat: createMaterial(0xffcc00, 0.2) },
        green: { entity: greenLight, material: greenMat, onMat: createMaterial(0x00ff44, 0.2) }
    });
}

function updateTrafficLightState(dt) {
    if (!gameRunning) return;
    lightTimer += dt;
    if (lightTimer >= lightChangeInterval) {
        lightTimer = 0;
        if (currentLightState === 'green') currentLightState = 'yellow';
        else if (currentLightState === 'yellow') currentLightState = 'red';
        else currentLightState = 'green';
    }

    trafficLights.forEach(function (tl) {
        tl.red.entity.model.material = (currentLightState === 'red') ? tl.red.onMat : tl.red.material;
        tl.yellow.entity.model.material = (currentLightState === 'yellow') ? tl.yellow.onMat : tl.yellow.material;
        tl.green.entity.model.material = (currentLightState === 'green') ? tl.green.onMat : tl.green.material;
        try {
            if (currentLightState === 'red') tl.red.entity.model.material.update();
            else if (currentLightState === 'yellow') tl.yellow.entity.model.material.update();
            else tl.green.entity.model.material.update();
        } catch (e) { }
    });
}

var aiPackChildCount = 0;

function fixModelDepth(entity) {
    var toUpdate = [];
    function scan(e) {
        if (e.model && e.model.meshInstances) {
            for (var i = 0; i < e.model.meshInstances.length; i++) {
                var mi = e.model.meshInstances[i];
                if (mi.material) {
                    mi.material.depthWrite = true;
                    mi.material.blendType = pc.BLEND_NONE;
                    mi.material.update();
                }
            }
        }
        for (var c = 0; c < e.children.length; c++) {
            scan(e.children[c]);
        }
    }
    scan(entity);
}

function removeGroundPlanes(entity) {
    var toRemove = [];
    function scan(e) {
        if (e.model && e.model.meshInstances) {
            for (var i = 0; i < e.model.meshInstances.length; i++) {
                var mi = e.model.meshInstances[i];
                if (mi.mesh) {
                    var vCount = mi.mesh.vertexBuffer ? mi.mesh.vertexBuffer.getNumVertices() : 999;
                    var isLarge = false;
                    if (mi.mesh.aabb) {
                        var he = mi.mesh.aabb.halfExtents;
                        if (he && (he.x > 10 || he.y > 10 || he.z > 10)) isLarge = true;
                    }
                    if (vCount < 50 || isLarge) {
                        toRemove.push(e);
                        return;
                    }
                }
            }
        }
        for (var c = 0; c < e.children.length; c++) {
            scan(e.children[c]);
        }
    }
    scan(entity);
    for (var i = 0; i < toRemove.length; i++) {
        toRemove[i].destroy();
    }
    return toRemove.length;
}

// ============================================
// CAR SELECTION
// ============================================
var carChoices = [];

function showCarSelection() {
    var ls = document.getElementById('loading-screen');
    ls.classList.add('fade-out');
    setTimeout(function () {
        ls.classList.add('hidden');
        document.getElementById('car-select-screen').classList.remove('hidden');
    }, 600);

    carChoices = [];
    var grid = document.getElementById('car-select-grid');
    grid.innerHTML = '';

    carChoices.push({ type: 'primitive', name: 'Sport Car', color: '#cc2222' });

    if (aiCarAsset) {
        var pack = aiCarAsset.resource.instantiateRenderEntity();
        if (pack) {
            var children = pack.children;
            for (var i = 0; i < children.length; i++) {
                if (children[i].model && children[i].model.meshInstances && children[i].model.meshInstances.length > 0) {
                    var hues = ['#3344ff', '#ffaa00', '#00cc44', '#ff44cc', '#44ffff', '#ff8800', '#8844ff', '#44ff88'];
                    carChoices.push({
                        type: 'pack',
                        name: 'Car ' + (carChoices.length),
                        color: hues[carChoices.length % hues.length],
                        childIndex: i
                    });
                }
            }
            pack.destroy();
        }
    }

    if (dirtyCarAsset) {
        carChoices.push({ type: 'dirty', name: 'Muscle Car', color: '#886633' });
    }
    if (flyingCarAsset) {
        carChoices.push({ type: 'flying', name: 'Flying Car', color: '#00aaff' });
    }

    carChoices.forEach(function (choice, idx) {
        var el = document.createElement('div');
        el.className = 'car-option';
        el.innerHTML = '<div class="car-option-icon" style="background:' + choice.color + '"></div>' +
            '<div class="car-option-name">' + choice.name + '</div>';
        el.addEventListener('click', function () {
            document.querySelectorAll('.car-option').forEach(function (o) { o.classList.remove('selected'); });
            el.classList.add('selected');
            selectedCarType = idx;
            document.getElementById('btn-drive').disabled = false;
        });
        grid.appendChild(el);
    });

    document.getElementById('btn-drive').onclick = function () {
        if (selectedCarType === null) return;
        var cs = document.getElementById('car-select-screen');
        cs.classList.add('fade-out');
        setTimeout(function () {
            cs.classList.add('hidden');
            buildWorld();
        }, 600);
    };
}

// ============================================
// PLAYER CAR
// ============================================
function createPlayerCar() {
    if (selectedCarType === null) selectedCarType = 0;
    var choice = carChoices[selectedCarType] || carChoices[0];

    var car = new pc.Entity('player_car');
    car.setPosition(0, 0.6, 0);
    app.root.addChild(car);
    carEntity = car;

    if (choice.type === 'dirty' && dirtyCarAsset) {
        var s = 4.0/255;
        var ent = instantiateModel(dirtyCarAsset, car, 0, 0, 0, s, s, s, 270, 180, 0);
        if (ent) { removeGroundPlanes(ent); }
    } else if (choice.type === 'flying' && flyingCarAsset) {
        var s = 4.0/255;
        var ent = instantiateModel(flyingCarAsset, car, 0, 0, 0, s, s, s, 270, 180, 0);
        if (ent) { removeGroundPlanes(ent); }
    } else if (choice.type === 'pack' && aiCarAsset) {
        var pack = aiCarAsset.resource.instantiateRenderEntity();
        if (pack) {
            var children = pack.children;
            var carChildren = [];
            for (var i = 0; i < children.length; i++) {
                if (children[i].model && children[i].model.meshInstances && children[i].model.meshInstances.length > 0) {
                    carChildren.push(children[i]);
                }
            }
            if (choice.childIndex < carChildren.length) {
                var picked = carChildren[choice.childIndex];
                picked.reparent(car);
                for (var j = 0; j < children.length; j++) {
                    if (children[j] !== picked && children[j].parent === pack) {
                        children[j].destroy();
                    }
                }
                pack.destroy();
            } else {
                pack.destroy();
                buildPrimitiveCar(car);
            }
        } else {
            buildPrimitiveCar(car);
        }
    } else {
        buildPrimitiveCar(car);
    }
}

function buildPrimitiveCar(car) {
    var bodyMat = createMaterial(0xcc2222, 0.4);
    var bodyDarkMat = createMaterial(0x991111, 0.5);
    var chromeMat = createMaterial(0xcccccc, 0.1);
    var glassMat = createMaterial(0x88ccff, 0.15);
    var glassDarkMat = createMaterial(0x336688, 0.2);
    var headlightMat = createMaterial(0xffffee, 0.1);
    var taillightMat = createMaterial(0xff2200, 0.15);
    var tireMat = createMaterial(0x222222, 0.9);
    var rimMat = createMaterial(0x888888, 0.2);
    var interiorMat = createMaterial(0x1a1a1a, 0.8);
    var detailMat = createMaterial(0x333333, 0.7);

    // Lower body
    addBox(car, 2.1, 0.55, 4.4, 0, 0.35, 0, bodyMat);
    // Upper body / cabin sides
    addBox(car, 1.9, 0.3, 2.6, 0, 0.8, -0.15, bodyDarkMat);
    // Hood (front slope)
    addBox(car, 1.85, 0.2, 1.2, 0, 0.65, 1.35, bodyMat);
    // Trunk (rear slope)
    addBox(car, 1.85, 0.2, 0.8, 0, 0.65, -1.85, bodyMat);
    // Roof
    addBox(car, 1.7, 0.15, 2.0, 0, 1.1, -0.2, bodyDarkMat);
    // Roof rails
    addBox(car, 1.75, 0.06, 0.08, 0, 1.2, -1.15, chromeMat);
    addBox(car, 1.75, 0.06, 0.08, 0, 1.2, 0.75, chromeMat);
    // Front windshield
    addBox(car, 1.6, 0.6, 0.06, 0, 0.85, 0.7, glassMat);
    // Rear windshield
    addBox(car, 1.5, 0.5, 0.06, 0, 0.85, -1.1, glassMat);
    // Side windows left
    addBox(car, 0.06, 0.4, 1.6, -0.92, 0.85, -0.2, glassMat);
    // Side windows right
    addBox(car, 0.06, 0.4, 1.6, 0.92, 0.85, -0.2, glassMat);
    // Door lines left
    addBox(car, 0.02, 0.7, 0.02, -1.04, 0.5, -0.2, detailMat);
    // Door lines right
    addBox(car, 0.02, 0.7, 0.02, 1.04, 0.5, -0.2, detailMat);
    // Door handles left
    addBox(car, 0.12, 0.04, 0.04, -1.06, 0.55, -0.1, chromeMat);
    // Door handles right
    addBox(car, 0.12, 0.04, 0.04, 1.06, 0.55, -0.1, chromeMat);
    // Side mirrors left
    addBox(car, 0.2, 0.1, 0.15, -1.2, 0.75, 0.4, bodyDarkMat);
    // Side mirrors right
    addBox(car, 0.2, 0.1, 0.15, 1.2, 0.75, 0.4, bodyDarkMat);
    // Front bumper
    addBox(car, 2.15, 0.25, 0.3, 0, 0.22, 2.2, bodyDarkMat);
    // Rear bumper
    addBox(car, 2.15, 0.25, 0.3, 0, 0.22, -2.2, bodyDarkMat);
    // Front grille
    addBox(car, 1.4, 0.3, 0.06, 0, 0.35, 2.18, detailMat);
    // Front splitter
    addBox(car, 1.8, 0.04, 0.15, 0, 0.12, 2.3, detailMat);
    // Headlights left
    addBox(car, 0.5, 0.18, 0.08, -0.6, 0.38, 2.2, headlightMat);
    // Headlights right
    addBox(car, 0.5, 0.18, 0.08, 0.6, 0.38, 2.2, headlightMat);
    // Taillights left
    addBox(car, 0.45, 0.15, 0.08, -0.65, 0.38, -2.2, taillightMat);
    // Taillights right
    addBox(car, 0.45, 0.15, 0.08, 0.65, 0.38, -2.2, taillightMat);
    // Exhaust pipes
    addCylinder(car, 0.08, 0.3, -0.35, 0.14, -2.35, chromeMat);
    addCylinder(car, 0.08, 0.3, 0.35, 0.14, -2.35, chromeMat);
    // Hood scoop
    addBox(car, 0.6, 0.1, 0.8, 0, 0.8, 1.0, detailMat);
    // Hood lines
    addBox(car, 0.02, 0.01, 0.8, 0, 0.76, 1.0, detailMat);
    addBox(car, 0.02, 0.01, 0.8, 0, 0.76, 1.4, detailMat);
    // Fender flares front
    addBox(car, 0.15, 0.35, 0.6, -1.1, 0.3, 1.3, bodyDarkMat);
    addBox(car, 0.15, 0.35, 0.6, 1.1, 0.3, 1.3, bodyDarkMat);
    // Fender flares rear
    addBox(car, 0.15, 0.35, 0.6, -1.1, 0.3, -1.3, bodyDarkMat);
    addBox(car, 0.15, 0.35, 0.6, 1.1, 0.3, -1.3, bodyDarkMat);
    // Side skirts
    addBox(car, 0.08, 0.12, 3.0, -1.08, 0.15, 0, detailMat);
    addBox(car, 0.08, 0.12, 3.0, 1.08, 0.15, 0, detailMat);
    // Rear spoiler
    addBox(car, 1.6, 0.06, 0.35, 0, 1.0, -2.05, bodyDarkMat);
    addBox(car, 0.08, 0.2, 0.08, -0.7, 0.9, -2.05, detailMat);
    addBox(car, 0.08, 0.2, 0.08, 0.7, 0.9, -2.05, detailMat);
    // Wheels (proper orientation - axis along Z)
    addWheel(car, -1.05, 0.3, 1.35, 0);
    addWheel(car, 1.05, 0.3, 1.35, 0);
    addWheel(car, -1.05, 0.3, -1.35, 0);
    addWheel(car, 1.05, 0.3, -1.35, 0);
    // Interior seats (visible through windows)
    addBox(car, 0.7, 0.35, 0.5, -0.3, 0.6, 0.0, interiorMat);
    addBox(car, 0.7, 0.35, 0.5, 0.3, 0.6, 0.0, interiorMat);
    // Steering wheel
    addCylinder(car, 0.12, 0.02, -0.35, 0.7, 0.3, interiorMat);
    // Dashboard
    addBox(car, 1.5, 0.15, 0.3, 0, 0.65, 0.45, interiorMat);
    // Side air intakes
    addBox(car, 0.06, 0.2, 0.5, -1.06, 0.35, 0.8, detailMat);
    addBox(car, 0.06, 0.2, 0.5, 1.06, 0.35, 0.8, detailMat);
}

function addWheel(parent, x, y, z) {
    var tireMat = createMaterial(0x1a1a1a, 0.9);
    var rimMat = createMaterial(0xaaaaaa, 0.15);
    var hubMat = createMaterial(0x666666, 0.3);
    // Tire (flat disc shape - rotate cylinder to face sideways)
    var tire = new pc.Entity();
    tire.addComponent('model', { type: 'cylinder', material: tireMat });
    tire.setLocalScale(0.36, 0.2, 0.36);
    tire.setPosition(x, y, z);
    tire.setLocalEulerAngles(0, 0, 0);
    parent.addChild(tire);
    // Tire sidewall edge
    var sidewall = new pc.Entity();
    sidewall.addComponent('model', { type: 'cylinder', material: createMaterial(0x151515, 0.9) });
    sidewall.setLocalScale(0.38, 0.18, 0.38);
    sidewall.setPosition(x, y, z);
    sidewall.setLocalEulerAngles(0, 0, 0);
    parent.addChild(sidewall);
    // Rim face (inner disc)
    var rimFace = new pc.Entity();
    rimFace.addComponent('model', { type: 'cylinder', material: createMaterial(0xbbbbbb, 0.1) });
    rimFace.setLocalScale(0.28, 0.21, 0.28);
    rimFace.setPosition(x, y, z);
    parent.addChild(rimFace);
    // Spokes (5 thin cylinders)
    for (var i = 0; i < 5; i++) {
        var a = (i / 5) * Math.PI * 2;
        var sx = x + Math.cos(a) * 0.12;
        var sz = z + Math.sin(a) * 0.12;
        var spoke = new pc.Entity();
        spoke.addComponent('model', { type: 'cylinder', material: rimMat });
        spoke.setLocalScale(0.04, 0.22, 0.04);
        spoke.setPosition(sx, y, sz);
        spoke.setLocalEulerAngles(0, 0, 0);
        parent.addChild(spoke);
    }
    // Center hub cap
    var hub = new pc.Entity();
    hub.addComponent('model', { type: 'cylinder', material: hubMat });
    hub.setLocalScale(0.08, 0.22, 0.08);
    hub.setPosition(x, y, z);
    parent.addChild(hub);
    // Brake disc (behind spokes, slightly smaller)
    var brake = new pc.Entity();
    brake.addComponent('model', { type: 'cylinder', material: createMaterial(0x555555, 0.5) });
    brake.setLocalScale(0.26, 0.22, 0.26);
    brake.setPosition(x, y, z);
    parent.addChild(brake);
}

function addBox(parent, sx, sy, sz, x, y, z, mat) {
    var e = new pc.Entity();
    e.addComponent('model', { type: 'box', material: mat });
    e.setLocalScale(sx, sy, sz);
    e.setPosition(x, y, z);
    parent.addChild(e);
    return e;
}

function addCylinder(parent, radius, height, x, y, z, mat) {
    var e = new pc.Entity();
    e.addComponent('model', { type: 'cylinder', material: mat });
    e.setLocalScale(radius * 2, height, radius * 2);
    e.setPosition(x, y, z);
    e.setLocalEulerAngles(90, 0, 0);
    parent.addChild(e);
    return e;
}

// ============================================
// CAR PHYSICS
// ============================================
function updateCarPhysics(dt) {
    if (!gameRunning || !carEntity) return;

    var fwd = 0, turn = 0;
    if (keys['w'] || keys['arrowup']) fwd = 1;
    if (keys['s'] || keys['arrowdown']) fwd = -1;
    if (keys['a'] || keys['arrowleft']) turn = 1;
    if (keys['d'] || keys['arrowright']) turn = -1;

    if (fwd > 0) carSpeed = Math.min(carSpeed + acceleration * dt, maxSpeed);
    else if (fwd < 0) { if (carSpeed > 0) carSpeed = Math.max(carSpeed - braking * dt, 0); else carSpeed = Math.max(carSpeed - acceleration * 0.5 * dt, -maxSpeed * 0.3); }
    else { if (carSpeed > 0) carSpeed = Math.max(0, carSpeed - naturalDecel * dt); else if (carSpeed < 0) carSpeed = Math.min(0, carSpeed + naturalDecel * dt); }

    if (driftActive && Math.abs(carSpeed) > 10) { driftMultiplier = 2.0; carSpeed *= 0.998; }
    else driftMultiplier = 1.0;

    if (Math.abs(carSpeed) > 0.1) {
        var curTurn = turn * turnSpeed * dt * (driftActive ? driftMultiplier : 1);
        carRotation += curTurn;
        carEntity.setLocalEulerAngles(0, carRotation, 0);
    }

    var rad = carRotation * Math.PI / 180;
    var pos = carEntity.getPosition();
    carEntity.setPosition(pos.x - Math.sin(rad) * carSpeed * dt * 0.15, pos.y, pos.z - Math.cos(rad) * carSpeed * dt * 0.15);
}

function resetCar() {
    if (!carEntity) return;
    carEntity.setPosition(0, 0.6, 0);
    carRotation = 0;
    carEntity.setLocalEulerAngles(0, 0, 0);
    carSpeed = 0;
}

// ============================================
// AI TRAFFIC
// ============================================
function spawnAICar(x, z, dir) {
    var aiCar = new pc.Entity('ai_car');
    aiCar.setPosition(x, 0.6, z);
    aiCar.setLocalEulerAngles(0, dir, 0);
    app.root.addChild(aiCar);

    var colors = [0x3344ff, 0xffaa00, 0x00cc44, 0xff44cc, 0x44ffff, 0xff8800, 0x8844ff, 0xff4444, 0x44ff88, 0xffffff];
    var color = colors[Math.floor(Math.random() * colors.length)];
    var bodyMat = createMaterial(color, 0.4);
    var darkMat = createMaterial(darkenColor(color, 0.5), 0.5);
    var glassMat = createMaterial(0x88ccff, 0.15);
    var headlightMat = createMaterial(0xffffee, 0.1);
    var taillightMat = createMaterial(0xff2200, 0.15);

    var carW = 2.0 + Math.random() * 0.2;
    var carH = 0.8 + Math.random() * 0.3;
    var carL = 4.0 + Math.random() * 0.5;

    addBox(aiCar, carW, carH * 0.6, carL, 0, carH * 0.3, 0, bodyMat);
    addBox(aiCar, carW * 0.9, carH * 0.4, carL * 0.55, 0, carH * 0.85, -carL * 0.08, darkMat);
    addBox(aiCar, carW * 0.85, carH * 0.35, carL * 0.5, 0, carH * 1.1, -carL * 0.08, darkMat);
    addBox(aiCar, carW * 0.8, 0.5, 0.05, 0, carH * 0.85, carL * 0.15, glassMat);
    addBox(aiCar, carW * 0.75, 0.4, 0.05, 0, carH * 0.85, -carL * 0.25, glassMat);
    addBox(aiCar, 0.05, 0.35, carL * 0.45, -carW * 0.47, carH * 0.85, -carL * 0.08, glassMat);
    addBox(aiCar, 0.05, 0.35, carL * 0.45, carW * 0.47, carH * 0.85, -carL * 0.08, glassMat);
    addBox(aiCar, 0.4, 0.15, 0.06, -carW * 0.3, carH * 0.4, carL / 2 + 0.03, headlightMat);
    addBox(aiCar, 0.4, 0.15, 0.06, carW * 0.3, carH * 0.4, carL / 2 + 0.03, headlightMat);
    addBox(aiCar, 0.35, 0.12, 0.06, -carW * 0.33, carH * 0.4, -carL / 2 - 0.03, taillightMat);
    addBox(aiCar, 0.35, 0.12, 0.06, carW * 0.33, carH * 0.4, -carL / 2 - 0.03, taillightMat);
    addBox(aiCar, carW + 0.1, carH * 0.2, 0.2, 0, carH * 0.15, carL / 2 + 0.05, darkMat);
    addBox(aiCar, carW + 0.1, carH * 0.2, 0.2, 0, carH * 0.15, -carL / 2 - 0.05, darkMat);

    aiCars.push({ entity: aiCar, direction: dir, speed: 15 + Math.random() * 15 });
}

function darkenColor(hex, factor) {
    var r = ((hex >> 16) & 0xff) * factor;
    var g = ((hex >> 8) & 0xff) * factor;
    var b = (hex & 0xff) * factor;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function spawnTrafficCar() {
    var g = cityGrid.gridCount, bs = cityGrid.blockSize, rw = cityGrid.roadWidth;
    var off = (g - 1) * bs / 2;
    var laneOffset = rw / 4;
    var axis = Math.random() < 0.5 ? 'x' : 'z';
    var roadIdx = Math.floor(Math.random() * g);
    var roadPos = roadIdx * bs - off;
    var side = Math.random() < 0.5 ? 1 : -1;
    var dir;
    var x, z;

    if (axis === 'x') {
        var startPos = (Math.random() - 0.5) * g * bs;
        x = startPos;
        z = roadPos + side * laneOffset;
        dir = 90;
    } else {
        var startPos = (Math.random() - 0.5) * g * bs;
        x = roadPos + side * laneOffset;
        z = startPos;
        dir = 0;
    }

    spawnAICar(x, z, dir);
}

function updateAI(dt) {
    if (!gameRunning) return;

    if (Math.random() < 0.008 && aiCars.length < 15) {
        spawnTrafficCar();
    }

    for (var i = aiCars.length - 1; i >= 0; i--) {
        var ai = aiCars[i];
        var rot = ai.entity.getLocalEulerAngles();
        var rad = rot.y * Math.PI / 180;

        var shouldStop = false;
        if (currentLightState === 'red') {
            for (var t = 0; t < trafficLights.length; t++) {
                var tl = trafficLights[t];
                var dx = ai.entity.getPosition().x - tl.position.x;
                var dz = ai.entity.getPosition().z - tl.position.z;
                if (Math.sqrt(dx * dx + dz * dz) < 15) { shouldStop = true; break; }
            }
        }

        if (!shouldStop) {
            var pos = ai.entity.getPosition();
            ai.entity.setPosition(pos.x - Math.sin(rad) * ai.speed * dt, pos.y, pos.z - Math.cos(rad) * ai.speed * dt);
        }

        var cp = ai.entity.getPosition();
        if (Math.abs(cp.x) > 250 || Math.abs(cp.z) > 250) {
            ai.entity.destroy();
            aiCars.splice(i, 1);
        }
    }
}

// ============================================
// CAMERA
// ============================================
function updateCamera(dt) {
    if (!carEntity) return;
    var carPos = carEntity.getPosition();
    var rad = carRotation * Math.PI / 180;
    var speedFactor = Math.min(Math.abs(carSpeed) / maxSpeed, 1);
    var offset, lookAhead;

    if (cameraMode === 0) {
        var dist = 10 + speedFactor * 6;
        var height = 4 + speedFactor * 4;
        offset = new pc.Vec3(Math.sin(rad) * dist, height, Math.cos(rad) * dist);
        lookAhead = new pc.Vec3(-Math.sin(rad) * 4, 1.2, -Math.cos(rad) * 4);
    } else if (cameraMode === 1) {
        offset = new pc.Vec3(0, 35, 0);
        lookAhead = new pc.Vec3(0, 0, 0);
    } else {
        offset = new pc.Vec3(-Math.sin(rad) * 0.3, 1.8, -Math.cos(rad) * 0.3);
        lookAhead = new pc.Vec3(-Math.sin(rad) * 15, 0.8, -Math.cos(rad) * 15);
    }

    var targetPos = new pc.Vec3().add2(carPos, offset);
    var curPos = cameraEntity.getPosition();
    var lerp = 1 - Math.pow(0.001, dt);

    cameraEntity.setPosition(
        pc.math.lerp(curPos.x, targetPos.x, lerp),
        pc.math.lerp(curPos.y, targetPos.y, lerp),
        pc.math.lerp(curPos.z, targetPos.z, lerp)
    );
    cameraEntity.lookAt(new pc.Vec3().add2(carPos, lookAhead));
}

// ============================================
// INPUT
// ============================================
function setupInput() {
    document.addEventListener('keydown', function (e) {
        keys[e.key.toLowerCase()] = true;
        if (e.key === ' ') { e.preventDefault(); driftActive = true; document.getElementById('drift-indicator').classList.add('drifting'); }
        if (e.key.toLowerCase() === 'c') cameraMode = (cameraMode + 1) % 3;
        if (e.key.toLowerCase() === 'r') resetCar();
    });
    document.addEventListener('keyup', function (e) {
        keys[e.key.toLowerCase()] = false;
        if (e.key === ' ') { driftActive = false; document.getElementById('drift-indicator').classList.remove('drifting'); }
    });
}

// ============================================
// UI
// ============================================
function toggleGame() {
    gameRunning = !gameRunning;
    var btn = document.getElementById('start-stop-btn');
    btn.textContent = gameRunning ? 'STOP ENGINE' : 'START ENGINE';
    btn.classList.toggle('running', gameRunning);
}

function updateUI() {
    document.getElementById('speed-value').textContent = Math.abs(Math.round(carSpeed));
}

// ============================================
// START
// ============================================
initEngine();
