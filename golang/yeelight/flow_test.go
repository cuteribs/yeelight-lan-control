package yeelight

import (
	"reflect"
	"testing"
)

func TestBuildFlowExpressionSerializesFlowTuples(t *testing.T) {
	expression, err := BuildFlowExpression([]FlowTuple{
		{Duration: 1000, Mode: 2, Value: 2700, Brightness: 100},
		{Duration: 1000, Mode: 1, Value: 0xff0000, Brightness: 20},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if expression != "1000,2,2700,100,1000,1,16711680,20" {
		t.Fatalf("unexpected expression: %q", expression)
	}
}

func TestSerializeSceneConvertsColorFlowScene(t *testing.T) {
	params, err := SerializeScene(Scene{
		Class:  "cf",
		Count:  0,
		Action: 1,
		FlowExpression: FlowExpression{
			Serialized: "500,1,16711680,50",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := []any{"cf", 0, 1, "500,1,16711680,50"}
	if !reflect.DeepEqual(params, expected) {
		t.Fatalf("unexpected params: %#v", params)
	}
}
