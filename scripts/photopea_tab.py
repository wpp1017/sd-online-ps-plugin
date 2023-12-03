import gradio as gr
from modules import script_callbacks
from modules.shared import opts
from modules import extensions

# Handy constants
PS_MAIN_URL = "https://autmake.com/sdplugin"
PS_IFRAME_ID = "webui-PS-iframe"
PS_IFRAME_HEIGHT = 790
PS_IFRAME_WIDTH = "100%"
PS_IFRAME_LOADED_EVENT = "onPSLoaded"


# Adds the "PS" tab to the WebUI
def on_ui_tabs():
    with gr.Blocks(analytics_enabled=False) as PS_tab:
        # Check if Controlnet is installed and enabled in settings, so we can show or hide the "Send to Controlnet" buttons.
        controlnet_exists = False
        for extension in extensions.active():
            if "controlnet" in extension.name:
                controlnet_exists = True
                break

        with gr.Row():
            # Add an iframe with PS directly in the tab.
            gr.HTML(
                f"""<iframe id="{PS_IFRAME_ID}"
                src = "{PS_MAIN_URL}{get_PS_url_params()}"
                width = "{PS_IFRAME_WIDTH}"
                height = "{PS_IFRAME_HEIGHT}"
                onload = "{PS_IFRAME_LOADED_EVENT}(this)">"""
            )
#         with gr.Row():
#             gr.Checkbox(
#                 label="Active Layer Only",
#                 info="If true, instead of sending the flattened image, will send just the currently selected layer.",
#                 elem_id="PS-use-active-layer-only",
#             )
#             try:
#                 num_controlnet_models = opts.control_net_unit_count
#             except:
#                 num_controlnet_models = 1
#
#             select_target_index = gr.Dropdown(
#                 [str(i) for i in range(num_controlnet_models)],
#                 label="ControlNet model index",
#                 value="0",
#                 interactive=True,
#                 visible=num_controlnet_models > 1,
#             )
#
#             gr.Slider(
#                 minimum=512,
#                 maximum=2160,
#                 value=790,
#                 step=10,
#                 label="iFrame height",
#                 interactive=True,
#                 elem_id="PSIframeSlider",
#             )

#         with gr.Row():
#             with gr.Column():
#                 gr.HTML(
#                     """<b>Controlnet extension not found!</b> Either <a href="https://github.com/Mikubill/sd-webui-controlnet" target="_blank">install it</a>, or activate it under Settings.""",
#                     visible=not controlnet_exists,
#                 )
#                 send_t2i_cn = gr.Button(
#                     value="Send to txt2img ControlNet", visible=controlnet_exists
#                 )
#                 send_extras = gr.Button(value="Send to Extras")
#
#             with gr.Column():
#                 send_i2i = gr.Button(value="Send to img2img")
#                 send_i2i_cn = gr.Button(
#                     value="Send to img2img ControlNet", visible=controlnet_exists
#                 )
#             with gr.Column():
#                 send_selection_inpaint = gr.Button(value="Inpaint selection")
#
#         with gr.Row():
#             gr.HTML(
#                 """<font size="small"><p align="right">Consider supporting PS by <a href="https://www.PS.com/api/accounts" target="_blank">going Premium</a>!</font></p>"""
#             )
#         send_t2i_cn.click(
#             None,
#             select_target_index,
#             None,
#             _js="(i) => {getAndSendImageToWebUITab('txt2img', true, i)}",
#         )
#         send_extras.click(
#             None,
#             select_target_index,
#             None,
#             _js="(i) => {getAndSendImageToWebUITab('extras', false, i)}",
#         )
#         send_i2i.click(
#             None,
#             select_target_index,
#             None,
#             _js="(i) => {getAndSendImageToWebUITab('img2img', false, i)}",
#         )
#         send_i2i_cn.click(
#             None,
#             select_target_index,
#             None,
#             _js="(i) => {getAndSendImageToWebUITab('img2img', true, i)}",
#         )
#         send_selection_inpaint.click(fn=None, _js="sendImageWithMaskSelectionToWebUi")

    return [(PS_tab, "PS", "PS_embed")]


# Initialize PS with an empty, 512x512 white image. It's baked as a base64 string with URI encoding.
def get_PS_url_params():
    return "#%7B%22resources%22:%5B%22data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIAAQMAAADOtka5AAAAAXNSR0IB2cksfwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAANQTFRF////p8QbyAAAADZJREFUeJztwQEBAAAAgiD/r25IQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfBuCAAAB0niJ8AAAAABJRU5ErkJggg==%22%5D%7D"


# Actually hooks up the tab to the WebUI tabs.
script_callbacks.on_ui_tabs(on_ui_tabs)
