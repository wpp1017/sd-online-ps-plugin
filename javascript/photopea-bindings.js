/* Setup and navigation */
var PSWindow = null;
var PSIframe = null;

// Creates a button in one of the WebUI galleries that will get the currently selected image in the 
// gallery.
// `queryId`: the id for the querySelector to search for the specific gallery list of buttons.
// `gallery`: the gallery div itself (cached by WebUI).
function createSendToPSButton(queryId, gallery) {
    const existingButton = gradioApp().querySelector(`#${queryId} button`);
    const newButton = existingButton.cloneNode(true);
    newButton.style.display = "flex";
    newButton.id = `${queryId}_open_in_PS`;
    newButton.title = "Send to PS"
    newButton.textContent = "PS";
    newButton.addEventListener("click", () => openImageInPS(gallery));
    existingButton.parentNode.appendChild(newButton);
}

// Switches to the "PS" tab by finding and clicking on the DOM button.
function goToPSTab() {
    // Find PS tab button, as we don't know which order it might appear in.
    const allButtons = gradioApp().querySelector('#tabs').querySelectorAll('button');
    // The space after the name seems to be added automatically for some reason, so this is likely
    // flaky across versions. We can't use "contains" because there's also "Send to PS"
    // buttons.
    PSTabButton = Array.from(allButtons).find(button => button.textContent === 'PS ');
    PSTabButton.click();
}

// Navigates the UI to the "Inpaint Upload" tab under the img2img tab.
// Gradio will destroy and recreate parts of the UI when swapping tabs, so we wait for the page to
// be refreshed before trying to find the relevant bits.
function goToImg2ImgInpaintUpload(onFinished) {
    // Start by swapping to the img2img tab.
    switch_to_img2img();
    const img2imgdiv = gradioApp().getElementById("mode_img2img");

    waitForWebUiUpdate(img2imgdiv).then(() => {
        const allButtons = img2imgdiv.querySelectorAll("div.tab-nav > button");
        const inpaintButton =
            Array.from(allButtons).find(button => button.textContent === 'Inpaint upload ');
        inpaintButton.click();
        onFinished();
    });
}

/* Image transfer functions */

// Returns true if the "Active Layer Only" checkbox is ticked, false otherwise.
function activeLayerOnly() {
    return gradioApp()
        .getElementById("PS-use-active-layer-only")
        .querySelector("input[type=checkbox]").checked;
}

// Gets the currently selected image in a WebUI gallery and opens it in PS.
function openImageInPS(originGallery) {
    var imageSizeMatches = true;
    const outgoingImg = originGallery.querySelectorAll("img")[0];
    goToPSTab();

    // First, check the image size to see if we have matching sizes. If it's bigger, we open it
    // as a new document. Otherwise, we just append it to the current document as a new layer.
    postMessageToPS(getPSScriptString(getActiveDocumentSize)).then((response) => {
        const activeDocSize = response[0].split(",");
        if (outgoingImg.naturalWidth > activeDocSize[0] || 
            outgoingImg.naturalHeight > activeDocSize[1]) {
            imageSizeMatches = false;
        }

        blobTob64(outgoingImg.src, (imageData) => {
            // Actually open the image, passing `imageSizeMatches` into PS's "open as new document" parameter.
            postMessageToPS(`app.open("${imageData}", null, ${imageSizeMatches});`, "*")
                .then(() => {
                    if (imageSizeMatches) {
                        postMessageToPS(`app.activeDocument.activeLayer.rasterize();`, "*");
                    } else {
                        postMessageToPS(
                            `alert("New document created as the image sent is bigger than the active document");`,
                            "*");
                    }
                });
        });

    });
}

// Requests the image from PS, converts the array result into a base64 png, then a blob, then
// actually send it to the WebUI.
function getAndSendImageToWebUITab(webUiTab, sendToControlnet, imageWidgetIndex, isCurrentLayer) {
    // PS only allows exporting the whole image, so in case "Active layer only" is selected in
    // the UI, instead of just requesting the image to be saved, we also make all non-selected
    // layers invisible.
    // const saveMessage = activeLayerOnly()
    //     ? getPSScriptString(exportSelectedLayerOnly)
    //     : 'app.activeDocument.saveToOE("png");';

    const saveMessage = isCurrentLayer === 'true'
      ? getPSScriptString(exportSelectedLayerOnly)
      : 'app.activeDocument.saveToOE("png");';

    postMessageToPS(saveMessage)
        .then((resultArray) => {
            // The first index of the payload is an ArrayBuffer of the image. We convert that to
            // base64 string, then to blob, so it can be sent to a specific image widget in WebUI.
            // There's likely a direct ArrayBuffer -> Blob conversion, but we're already using b64
            // as an intermediate format.
            const base64Png = base64ArrayBuffer(resultArray[0]);
            sendImageToWebUi(
                webUiTab,
                sendToControlnet,
                imageWidgetIndex,
                b64toBlob(base64Png, "image/png"));
        });
}

// Send image to a specific image widget in a Web UI tab. This basically navigates the DOM graph via
// queries, and magically presses buttons. You web developers sure work some dark magic.
function sendImageToWebUi(webUiTab, sendToControlNet, controlnetModelIndex, blob) {
    const file = new File([blob], "PS_output.png")

    switch (webUiTab) {
        case "txt2img":
            switch_to_txt2img();
            break;
        case "img2img":
            switch_to_img2img();
            break;
        case "extras":
            switch_to_extras();
            break;
    }

    if (sendToControlNet) {
        // First, select the ControlNet accordion div.
        const tabId = webUiTab === "txt2img"
            ? "#txt2img_script_container"
            : "#img2img_script_container";
        const controlNetDiv = gradioApp().querySelector(tabId).querySelector("#controlnet");
        // Check if the ControlNet accordion is open by finding the image editing iFrames.
        setImageOnControlNetInput(controlNetDiv, controlnetModelIndex, file);
    } else {
        // For regular tabs, it's less involved - we can simply set the image on input directly.
        const imageInput = gradioApp().getElementById(`mode_${webUiTab}`).querySelector("input[type='file']");
        setImageOnInput(imageInput, file);
    }
}

// I couldn't figure out a way to inject a mask directly on an image widget. So to have an easy way
// of masking inpainting via selection, we send the image to "Inpaint Upload", and create a mask
// from selection.
function sendImageWithMaskSelectionToWebUi() {
    // Start by verifying if there actually is a selection in the document.
    postMessageToPS(getPSScriptString(selectionExists))
        .then((response) => {
            if (response[0] === false) {
                // In case there isn't, do an in-PS alert (which is less intrusive but more
                // visible).
                postMessageToPS(`alert("No selection in active document!");`);
            } else {
                // Let's start by swapping to the correct tab. This is a bit more involved due to
                // Gradio's reconstruction of disabled UI elements.
                goToImg2ImgInpaintUpload(() => {
                    // In case there is a selection, we'll pass a whole script payload to PS
                    // to create the mask and export it.
                    const fullMessage =
                        getPSScriptString(createMaskFromSelection) + // 1. Create the mask
                        getPSScriptString(exportSelectedLayerOnly) + // 2. Function that exports the image
                        `app.activeDocument.activeLayer.remove();`;        // 3. Removes the temp mask layer

                    postMessageToPS(fullMessage).then((resultArray) => {
                        // Set the mask.
                        const base64Png = base64ArrayBuffer(resultArray[0]);
                        const maskInput = gradioApp().getElementById("img_inpaint_mask").querySelector("input");
                        const blob = b64toBlob(base64Png, "image/png");
                        const file = new File([blob], "PS_output.png");
                        setImageOnInput(maskInput, file);

                        // Now go in and get the actual image.
                        const saveMessage = activeLayerOnly()
                            ? getPSScriptString(exportSelectedLayerOnly)
                            : 'app.activeDocument.saveToOE("png");';

                        postMessageToPS(saveMessage)
                            .then((resultArray) => {
                                const base64Png = base64ArrayBuffer(resultArray[0]);
                                const baseImgInput = gradioApp().getElementById("img_inpaint_base").querySelector("input");
                                const blob = b64toBlob(base64Png, "image/png");
                                const file = new File([blob], "PS_output.png");
                                setImageOnInput(baseImgInput, file);
                            });
                    });
                });
            }
        });
}

// Navigates to the correct ControlNet model tab, then sets the image.
function setImageOnControlNetInput(controlNetDiv, controlNetModelIndex, file) {
    if (controlNetAccordionIsCollapsed(controlNetDiv)) {
        // The accordion is not open. Find the little icon arrow and click it (yes, if the arrow
        // ever changes, this will break).
        controlNetDiv.querySelector("span.icon").click();
    }
    waitForWebUiUpdate(controlNetDiv).then(() => {
        // When more than one Controlnet model is enabled in the WebUI settings, there will be a
        // series of Controlnet tabs. The one selected in the dropdown will be passed in by the
        // `controlnetModelIndex`.
        const tabs = controlNetDiv.querySelectorAll("div.tab-nav > button");
        if (tabs !== null && tabs.length > 1) {
            tabs[controlNetModelIndex].click();
        }

        // HACK: multiplying the index by 2 to match the proper input on the newest ControlNet extension
        // was determined empirically and will likely break in the future (as all other DOM-based 
        // addressing tends to)
        imageInput = controlNetDiv.querySelectorAll("input[type='file']")[controlNetModelIndex * 2];
        setImageOnInput(imageInput, file);
    }
    );
}

// Gradio's image widgets are inputs. To set the image in one, we set the image on the input and
// force it to refresh.
function setImageOnInput(imageInput, file) {
    // Createa a data transfer element to set as the data in the input.
    const dt = new DataTransfer();
    dt.items.add(file);
    const list = dt.files;

    // Actually set the image in the image widget.
    imageInput.files = list;

    // Foce the image widget to update with the new image, after setting its source files.
    const event = new Event('change', {
        'bubbles': true,
        "composed": true
    });
    imageInput.dispatchEvent(event);
}

// Transforms a JS function body into a string that can be passed as a message to PS.
function getPSScriptString(func) {
    return func.toString() + `${func.name}();`
}

// Posts a message and receives back a promise that will eventually return a 2-element array. One of
// them will be PS's "done" message, and the other the actual payload.
async function postMessageToPS(message) {
    var request = new Promise(function (resolve, reject) {
        var responses = [];
        var PSMessageHandle = function (response) {
            responses.push(response.data);
            // PS will first return the resulting data as a message to the parent window, then
            // another message saying "done". When we receive the latter, we fulfill the promise.
            if (response.data == "done") {
                window.removeEventListener("message", PSMessageHandle);
                resolve(responses)
            }
        };
        // Add a listener to wait for PS's response messages.
        window.addEventListener("message", PSMessageHandle);
    });
    // Actually execute the request to PS.
    PSWindow.postMessage(message, "*");
    return await request;
}

// Returns a promise that will be resolved when the div passed in the parameter is modified.
// This will happen when Gradio reconstructs the UI after, e.g., changing tabs.
async function waitForWebUiUpdate(divToWatch) {
    const promise = new Promise((resolve, reject) => {
        // Options for the observer (which mutations to observe)
        const mutationConfig = { attributes: true, childList: true, subtree: true };
        // Callback for when mutation happened. Will simply invoke the passed `onDivUpdated` and
        // stop observing.
        const onMutationHappened = (mutationList, observer) => {
            observer.disconnect();
            resolve();
        }
        const observer = new MutationObserver(onMutationHappened);
        observer.observe(divToWatch, mutationConfig);
    });

    return await promise;
}

// Gradio keeps changing how their DOM works, so we just use some heuristic here to find out
// which child div is the one that contains the ControlNet image inputs. If that one is not
// displayed, we consider the accordion is closed. Other methods include direct indices, or
// checking if the arrow is tilted 90 degrees on the style, both seemed flakier.
function controlNetAccordionIsCollapsed(controlNetDiv) {
    // Get the immediate children of the ControlNet accordion. One of them will contain the
    // actual image widgets.
    const directDescendents = controlNetDiv.children;
    // All of the image iframes are contained within the same content div, so we can use any.
    const sampleIframe = controlNetDiv.querySelectorAll("iframe")[0];

    for(var i = 0; i < directDescendents.length; i++) {
        if(directDescendents[i].contains(sampleIframe)) {
            return directDescendents[i].style['display'] === 'none';
        }
    }
    // As a fallback, to prevent constantly triggering the toggle in case future versions break
    // this heuristic, we just return false.
    return false;
}

// Called by the iframe set up on PS-tab.py.
function onPSLoaded(iframe) {
    console.log("PS iFrame loaded");
    PSWindow = iframe.contentWindow;
    PSIframe = iframe;

    // Clone some buttons to send the contents of galleries in txt2img, img2img and extras tabs
    // to PS. You can also just copy-paste the images directly but these are the ones I
    // use the most.
    createSendToPSButton("image_buttons_txt2img", window.txt2img_gallery);
    createSendToPSButton("image_buttons_img2img", window.img2img_gallery);
    createSendToPSButton("image_buttons_extras", window.extras_gallery);

    // Listen to the size slider changes.
    // gradioApp().getElementById("PSIframeSlider").addEventListener('input', (event) => {
    //     // Get the value of the slider and parse it as an integer
    //     const newHeight = parseInt(event.target.value);
    //
    //     // Update the height of the iframe
    //     PSIframe.style.height = newHeight + 'px';
    // });

    // 接收来自子级页面的消息
    window.addEventListener('message', function(event) {
        const {type,webUiTab, sendToControlnet, imageWidgetIndex, isCurrentLayer} = event.data;
        if(type === 'getAndSendImageToWebUITab') {
            getAndSendImageToWebUITab(webUiTab, sendToControlnet, imageWidgetIndex, isCurrentLayer);
        }
        if(type === 'sendImageWithMaskSelectionToWebUi') {
            sendImageWithMaskSelectionToWebUi();
        }
        console.log('父级页面接收到消息：', event);
    });

}
