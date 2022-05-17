var funcs = []

for (var i = 0; i < 10; i++) {
    funcs.push(function(){
        console.log(i)
    })
}
funcs[2]() // Gera valor 10 pois não tem escopo como função
funcs[8]() // Gera valor 10 pois não tem escopo como função