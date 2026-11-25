import base64, json, os
D = os.path.join(r'C:\Users\viaco\.zcode', 'cli', 'image-cache', 'sess_c0c2c9b5-5c78-4021-be0f-af7a077a95fb')
for f in ['image-3707947892a5d54268c76ec74e281399.png', 'image-f0c99e825362f2d601c8668e139b31a0.png']:
    d = base64.b64encode(open(os.path.join(D, f), 'rb').read()).decode()
    body = {'model': 'MiniMax-M3.1-Flash', 'messages': [{'role': 'user', 'content': [
        {'type': 'text', 'text': 'Describe this screenshot in full detail: every visible UI element, exact text, buttons, and any red annotation marks (arrows, circles, crosses) and exactly what they point at.'},
        {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + d}}]}], 'max_tokens': 2500}
    json.dump(body, open('a_' + f + '.json', 'w'))
    print('ok', f)
