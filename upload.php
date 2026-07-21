<?php
// Security check
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $target_dir = __DIR__ . '/';
    $max_file_size = 100 * 1024 * 1024; // 100MB
    
    // Handle file uploads
    if (isset($_FILES['files'])) {
        $files = $_FILES['files'];
        $errors = [];
        $uploaded = [];
        
        for ($i = 0; $i < count($files['name']); $i++) {
            $file_name = basename($files['name'][$i]);
            $file_size = $files['size'][$i];
            $file_tmp = $files['tmp_name'][$i];
            $file_error = $files['error'][$i];
            
            // Security: Check for directory traversal
            if (strpos($file_name, '..') !== false || strpos($file_name, '/') === 0) {
                $errors[] = "Invalid filename: $file_name";
                continue;
            }
            
            if ($file_error === UPLOAD_ERR_OK) {
                if ($file_size > $max_file_size) {
                    $errors[] = "$file_name exceeds maximum file size";
                    continue;
                }
                
                $target_file = $target_dir . $file_name;
                
                // Create directories if they don't exist
                $dir = dirname($target_file);
                if (!is_dir($dir)) {
                    if (!mkdir($dir, 0755, true)) {
                        $errors[] = "Failed to create directory: $dir";
                        continue;
                    }
                }
                
                if (move_uploaded_file($file_tmp, $target_file)) {
                    $uploaded[] = $file_name;
                    chmod($target_file, 0644);
                } else {
                    $errors[] = "Failed to upload: $file_name";
                }
            } else {
                $errors[] = "Upload error for $file_name: " . $file_error;
            }
        }
        
        // Return JSON response
        header('Content-Type: application/json');
        echo json_encode([
            'success' => count($errors) === 0,
            'uploaded' => $uploaded,
            'errors' => $errors
        ]);
        exit;
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cargar archivos - Shelby Importaciones</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 10px;
        }
        .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }
        .drop-zone {
            border: 2px dashed #007bff;
            border-radius: 8px;
            padding: 40px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s;
            background: #f8f9fa;
        }
        .drop-zone.dragover {
            background: #e7f1ff;
            border-color: #0056b3;
        }
        .drop-zone p {
            margin: 0;
            color: #666;
        }
        input[type="file"] {
            display: none;
        }
        .progress {
            margin-top: 20px;
            display: none;
        }
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: #28a745;
            width: 0%;
            transition: width 0.3s;
        }
        .status {
            margin-top: 15px;
            padding: 15px;
            border-radius: 4px;
            display: none;
        }
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
            display: block;
        }
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            display: block;
        }
        .file-list {
            list-style: none;
            padding: 0;
            margin: 10px 0;
        }
        .file-list li {
            padding: 5px 0;
            color: #155724;
        }
        .file-list li:before {
            content: "✓ ";
            font-weight: bold;
            margin-right: 5px;
        }
        .error-list {
            list-style: none;
            padding: 0;
            margin: 10px 0;
        }
        .error-list li {
            padding: 5px 0;
            color: #721c24;
        }
        .error-list li:before {
            content: "✗ ";
            font-weight: bold;
            margin-right: 5px;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-top: 10px;
        }
        button:hover {
            background: #0056b3;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📤 Cargar archivos</h1>
        <p class="subtitle">Sube los archivos del proyecto Shelby</p>
        
        <div class="drop-zone" id="dropZone">
            <p>Arrastra los archivos aquí o haz clic para seleccionar</p>
            <input type="file" id="fileInput" multiple />
        </div>
        
        <div class="progress" id="progress">
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
        </div>
        
        <div id="status"></div>
    </div>

    <script>
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const progress = document.getElementById('progress');
        const progressFill = document.getElementById('progressFill');
        const status = document.getElementById('status');

        // Click to select files
        dropZone.addEventListener('click', () => fileInput.click());

        // Drag and drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            handleFiles(files);
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });

        async function handleFiles(files) {
            if (files.length === 0) return;

            const formData = new FormData();
            for (let file of files) {
                formData.append('files[]', file, file.webkitRelativePath || file.name);
            }

            progress.style.display = 'block';
            status.innerHTML = '';

            try {
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = (e.loaded / e.total) * 100;
                        progressFill.style.width = percentComplete + '%';
                    }
                });

                xhr.addEventListener('load', () => {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        showStatus(response);
                    } catch (e) {
                        showError('Error en la respuesta del servidor');
                    }
                });

                xhr.addEventListener('error', () => {
                    showError('Error de conexión');
                });

                xhr.open('POST', window.location.href);
                xhr.send(formData);
            } catch (e) {
                showError(e.message);
            }
        }

        function showStatus(response) {
            let html = '';
            
            if (response.uploaded && response.uploaded.length > 0) {
                html += '<div class="status success">';
                html += '<strong>✓ Carga exitosa</strong>';
                html += '<ul class="file-list">';
                response.uploaded.forEach(file => {
                    html += `<li>${file}</li>`;
                });
                html += '</ul>';
                html += '</div>';
            }

            if (response.errors && response.errors.length > 0) {
                html += '<div class="status error">';
                html += '<strong>✗ Errores</strong>';
                html += '<ul class="error-list">';
                response.errors.forEach(error => {
                    html += `<li>${error}</li>`;
                });
                html += '</ul>';
                html += '</div>';
            }

            status.innerHTML = html;
            progress.style.display = 'none';
            progressFill.style.width = '0%';
        }

        function showError(message) {
            status.innerHTML = `<div class="status error"><strong>✗ Error</strong><p>${message}</p></div>`;
            progress.style.display = 'none';
        }
    </script>
</body>
</html>
