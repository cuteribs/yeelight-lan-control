use serde_json::json;
use yeelight_cli::{
    FlowExpression, YeelightFlowTuple, YeelightScene, build_flow_expression, serialize_scene,
};

#[test]
fn build_flow_expression_serializes_flow_tuples() {
    let expression = build_flow_expression(&[
        YeelightFlowTuple {
            duration: 1000,
            mode: 2,
            value: 2700,
            brightness: 100,
        },
        YeelightFlowTuple {
            duration: 1000,
            mode: 1,
            value: 0xff0000,
            brightness: 20,
        },
    ])
    .expect("flow expression");

    assert_eq!(expression, "1000,2,2700,100,1000,1,16711680,20");
}

#[test]
fn serialize_scene_converts_color_flow_scene() {
    let params = serialize_scene(&YeelightScene::Cf {
        count: 0,
        action: 1,
        flow_expression: FlowExpression::Serialized("500,1,16711680,50".to_owned()),
    })
    .expect("scene params");

    assert_eq!(params, vec![json!("cf"), json!(0), json!(1), json!("500,1,16711680,50")]);
}
